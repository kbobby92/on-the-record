"""Download campaign finance totals and top contributor employers for each senator
into data/raw/money.json.

Source: the Federal Election Commission's OpenFEC API.
Set FEC_API_KEY (free at api.data.gov/signup). Without it the shared DEMO_KEY is used,
which is heavily rate-limited and will likely only cover a few senators per run.
"""
import json, os, time
from datetime import datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "money.json")
SENATORS = os.path.join(ROOT, "data", "senators.json")
API = "https://api.open.fec.gov/v1"
KEY = os.environ.get("FEC_API_KEY") or "DEMO_KEY"


def call(path, **params):
    params["api_key"] = KEY
    for i in range(3):
        r = requests.get(API + path, params=params, timeout=60)
        if r.status_code == 429:
            time.sleep(30 * (i + 1))
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError("rate limited: " + path)


def main():
    with open(SENATORS, encoding="utf-8") as f:
        senators = json.load(f)["senators"]
    store = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            store = json.load(f)
    # Refresh the stalest records first so a rate-limited run still makes progress.
    senators.sort(key=lambda s: store.get(s["bioguide"], {}).get("fetched", ""))
    done = 0
    for s in senators:
        cand = next((c for c in s["fec"] if c.startswith("S")), None)
        if not cand:
            continue
        cycle = s["next_election"]
        try:
            tot = call(f"/candidate/{cand}/totals/", cycle=cycle, election_full="true")["results"]
            t = tot[0] if tot else {}
            comms = call(f"/candidate/{cand}/committees/", designation="P", cycle=cycle)["results"]
            top = []
            if comms:
                emp = call("/schedules/schedule_a/by_employer/", committee_id=comms[0]["committee_id"],
                           cycle=cycle, sort="-total", per_page=10)["results"]
                skip = {"", "NONE", "N/A", "RETIRED", "SELF-EMPLOYED", "SELF EMPLOYED", "NOT EMPLOYED",
                        "INFORMATION REQUESTED", "INFORMATION REQUESTED PER BEST EFFORTS", "HOMEMAKER"}
                top = [{"employer": e["employer"], "total": e["total"], "count": e.get("count")}
                       for e in emp if (e.get("employer") or "").upper() not in skip][:8]
            store[s["bioguide"]] = {
                "candidate_id": cand, "cycle": cycle,
                "period": f"{t.get('coverage_start_date', '')[:10]} to {t.get('coverage_end_date', '')[:10]}",
                "receipts": t.get("receipts"),
                "disbursements": t.get("disbursements"),
                "cash_on_hand": t.get("last_cash_on_hand_end_period"),
                "individual": t.get("individual_contributions"),
                "pacs": t.get("other_political_committee_contributions"),
                "party": t.get("political_party_committee_contributions"),
                "self_funded": (t.get("candidate_contribution") or 0) + (t.get("loans_made_by_candidate") or 0),
                "top_employers": top,
                "committee_id": comms[0]["committee_id"] if comms else None,
                "source": f"https://www.fec.gov/data/candidate/{cand}/?cycle={cycle}&election_full=true",
                "fetched": datetime.now(timezone.utc).isoformat(timespec="minutes"),
            }
            done += 1
        except RuntimeError as e:
            print("Stopping early:", e)
            break
        except Exception as e:
            print("failed", s["name"], e)
        time.sleep(0.5)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=1)
    print(f"Updated {done} senators; {len(store)} on file")


if __name__ == "__main__":
    main()
