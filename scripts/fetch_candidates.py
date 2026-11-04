"""Download every active Senate candidate for the upcoming election, with money totals,
into data/raw/candidates.json.

Source: the Federal Election Commission (OpenFEC /candidates/totals/). Needs FEC_API_KEY.
"""
import json, os, time
from datetime import date, datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "candidates.json")
API = "https://api.open.fec.gov/v1"
KEY = os.environ.get("FEC_API_KEY") or "DEMO_KEY"


def election_year():
    y = date.today().year
    # Keep showing this year's races until results are certified (into January).
    return y if y % 2 == 0 else (y - 1 if date.today().month == 1 else y + 1)


def main():
    year = int(os.environ.get("ELECTION_YEAR") or election_year())
    rows, page = [], 1
    while True:
        for attempt in range(3):
            r = requests.get(API + "/candidates/totals/", timeout=60, params={
                "api_key": KEY, "office": "S", "election_year": year, "election_full": "true",
                "is_active_candidate": "true", "per_page": 100, "page": page, "sort": "-receipts"})
            if r.status_code == 429:
                time.sleep(30 * (attempt + 1))
                continue
            r.raise_for_status()
            break
        else:
            raise SystemExit("FEC rate limit; try again later")
        data = r.json()
        rows += data.get("results", [])
        if page >= data.get("pagination", {}).get("pages", 1):
            break
        page += 1
        time.sleep(0.5)

    out = []
    for c in rows:
        out.append({
            "candidate_id": c.get("candidate_id"),
            "name": c.get("name"),
            "party": c.get("party"),
            "party_full": c.get("party_full"),
            "state": c.get("state"),
            "status": c.get("incumbent_challenge"),          # I = incumbent, C = challenger, O = open seat
            "receipts": c.get("receipts"),
            "disbursements": c.get("disbursements"),
            "cash_on_hand": c.get("cash_on_hand_end_period"),
            "through": (c.get("coverage_end_date") or "")[:10],
            "source": f"https://www.fec.gov/data/candidate/{c.get('candidate_id')}/?cycle={year}&election_full=true",
        })
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"year": year, "fetched": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "candidates": out}, f, indent=1)
    print(f"{len(out)} active {year} Senate candidates saved")


if __name__ == "__main__":
    main()
