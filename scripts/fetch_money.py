"""Download campaign finance for each senator into data/raw/money.json:
  - campaign committee totals and top donor employers (daily)
  - donations by size, by state (in-state share), and any leadership PAC (weekly)

Source: the Federal Election Commission's OpenFEC API.
Set FEC_API_KEY (free at api.data.gov/signup). Without it the shared DEMO_KEY is used,
which is heavily rate-limited and will likely only cover a few senators per run.
"""
import json, os, time
from datetime import datetime, timedelta, timezone

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
            prev = store.get(s["bioguide"], {})
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
            } | {k: prev[k] for k in ("sizes", "states", "in_state", "leadership_pac", "details_fetched") if k in prev}
            done += 1
        except RuntimeError as e:
            print("Stopping early:", e)
            break
        except Exception as e:
            print("failed", s["name"], e)
        time.sleep(0.5)
    detailed = 0
    week_ago = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    by_bio = {s["bioguide"]: s for s in senators}
    for bid in sorted(store, key=lambda b: store[b].get("details_fetched", "")):
        m = store[bid]
        if m.get("details_fetched", "") > week_ago or bid not in by_bio:
            continue
        try:
            details(m, by_bio[bid]["state"])
            detailed += 1
        except RuntimeError as e:
            print("Stopping details early:", e)
            break
        except Exception as e:
            print("details failed", bid, e)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(store, f, indent=1)
    print(f"Updated {done} senators; refreshed details for {detailed}; {len(store)} on file")


SIZE_LABEL = {0: "$200 and under", 200: "$200.01–$499", 500: "$500–$999", 1000: "$1,000–$1,999", 2000: "$2,000 and over"}


def details(m, home_state):
    """Donations by size and by state, and leadership PAC, for one senator's campaign."""
    cand, cycle = m["candidate_id"], m["cycle"]
    sizes = call("/schedules/schedule_a/by_size/by_candidate/", candidate_id=cand, cycle=cycle,
                 election_full="true", per_page=20)["results"]
    agg = {}
    for r in sizes:
        agg[int(r.get("size") or 0)] = agg.get(int(r.get("size") or 0), 0) + (r.get("total") or 0)
    m["sizes"] = [{"size": k, "label": SIZE_LABEL.get(k, f"${k}+"), "total": round(v, 2)} for k, v in sorted(agg.items())]
    time.sleep(0.4)
    states = call("/schedules/schedule_a/by_state/by_candidate/", candidate_id=cand, cycle=cycle,
                  election_full="true", per_page=100)["results"]
    st = {}
    for r in states:
        code = (r.get("state") or "").upper()
        if code:
            st[code] = st.get(code, 0) + (r.get("total") or 0)
    itemized = sum(st.values())
    m["states"] = [{"state": k, "total": round(v, 2)} for k, v in sorted(st.items(), key=lambda kv: -kv[1])[:10]]
    m["in_state"] = {"total": round(st.get(home_state, 0), 2), "itemized": round(itemized, 2),
                     "pct": round(100 * st.get(home_state, 0) / itemized, 1) if itemized else None}
    time.sleep(0.4)
    lp = call(f"/candidate/{cand}/committees/", designation="D", per_page=5)["results"]
    m["leadership_pac"] = None
    if lp:
        c = lp[0]
        two_year = datetime.now(timezone.utc).year + datetime.now(timezone.utc).year % 2
        tot = call(f"/committee/{c['committee_id']}/totals/", cycle=two_year)["results"]
        t = tot[0] if tot else {}
        m["leadership_pac"] = {"name": c.get("name"), "committee_id": c["committee_id"], "cycle": two_year,
                               "receipts": t.get("receipts"), "disbursements": t.get("disbursements"),
                               "to_candidates": t.get("contributions_to_candidates_and_other_committees") or t.get("contributions"),
                               "source": f"https://www.fec.gov/data/committee/{c['committee_id']}/?cycle={two_year}"}
        time.sleep(0.4)
    m["details_fetched"] = datetime.now(timezone.utc).isoformat(timespec="minutes")


if __name__ == "__main__":
    main()
