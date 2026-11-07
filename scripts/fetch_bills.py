"""Bills each senator sponsored or cosponsored in the current Congress, from the Congress.gov API.

Writes data/raw/bills.json:
  {"updated": ..., "congress": 119, "members": {bioguide: {"sponsored": [...], "cosponsored": [...],
                                                          "sponsored_total": n, "cosponsored_total": n}}}

Each bill: type, number, name ("S. 123"), title, introduced, action_date, action (latest action text),
policy (Congress.gov policy area), stage (law / vetoed / passed / adopted / failed / advanced / introduced) and url.

"stage" is read from the latest action text, so it is a best guess. The site shows the latest action
word for word next to it. Needs CONGRESS_API_KEY. Skips if the data is under 20 hours old, unless --force.
"""
import json, os, re, sys, time
from datetime import datetime, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)
KEY = os.environ.get("CONGRESS_API_KEY")
CONGRESS = 119
API = "https://api.congress.gov/v3/member/{bio}/{kind}-legislation"
MAX_COSPONSORED = 400  # per senator, newest first
SHOWN = []

NAME = {"S": "S.", "SRES": "S.Res.", "SJRES": "S.J.Res.", "SCONRES": "S.Con.Res.",
        "HR": "H.R.", "HRES": "H.Res.", "HJRES": "H.J.Res.", "HCONRES": "H.Con.Res."}
SLUG = {"S": "senate-bill", "SRES": "senate-resolution", "SJRES": "senate-joint-resolution",
        "SCONRES": "senate-concurrent-resolution", "HR": "house-bill", "HRES": "house-resolution",
        "HJRES": "house-joint-resolution", "HCONRES": "house-concurrent-resolution"}


def stage(btype, text):
    t = (text or "").lower()
    if "became public law" in t or "signed by president" in t:
        return "law"
    if "vetoed" in t or "veto message" in t:
        return "vetoed"
    if btype in ("SRES", "HRES") and ("agreed to" in t or "adopted" in t):
        return "adopted"  # simple resolutions only need one chamber
    if any(k in t for k in ("passed senate", "passed house", "passed/agreed to", "received in the house",
                            "received in the senate", "message on senate action", "held at the desk",
                            "presented to president", "agreed to in senate", "agreed to in house",
                            "cleared for white house", "resolving differences")):
        return "passed"
    if any(k in t for k in ("failed of passage", "rejected by", "not agreed to", "cloture not invoked",
                            "cloture on the motion to proceed not invoked", "failed by")):
        return "failed"  # got a floor vote and lost
    chamber = "S" if btype.startswith("S") else "H"
    # A Senate bill whose latest action is a House committee referral has already passed the Senate.
    if chamber == "S" and t.startswith("referred to the") and "read twice" not in t:
        return "passed"
    if chamber == "H" and "read twice" in t:
        return "passed"
    if any(k in t for k in ("reported", "placed on senate legislative calendar", "placed on the union calendar",
                            "placed on the house calendar", "ordered to be reported", "cloture",
                            "motion to proceed", "considered", "discharged")):
        return "advanced"
    return "introduced"


def row(item):
    btype = (item.get("type") or "").upper()
    num = str(item.get("number") or "")
    la = item.get("latestAction") or {}
    return {"type": btype, "number": num, "name": f"{NAME.get(btype, btype)} {num}",
            "title": (item.get("title") or "").strip(), "introduced": item.get("introducedDate"),
            "action_date": la.get("actionDate"), "action": la.get("text"),
            "policy": (item.get("policyArea") or {}).get("name"), "stage": stage(btype, la.get("text")),
            "url": f"https://www.congress.gov/bill/{CONGRESS}th-congress/{SLUG.get(btype, 'senate-bill')}/{num}"}


def fetch(bio, kind, cap):
    out, total, offset = [], None, 0
    key = "sponsoredLegislation" if kind == "sponsored" else "cosponsoredLegislation"
    while True:
        for attempt in range(4):
            try:
                r = requests.get(API.format(bio=bio, kind=kind), timeout=60,
                                 params={"api_key": KEY, "format": "json", "limit": 250, "offset": offset})
                if r.status_code == 429:
                    time.sleep(30 * (attempt + 1)); continue
                r.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt == 3:
                    raise
                print(f"  retry {bio} {kind}: {e}"); time.sleep(5 * (attempt + 1))
        page = r.json().get(key) or []
        if not SHOWN and page:
            SHOWN.append(1); print("Sample item:", json.dumps(page[0])[:600])
        if not page:
            break
        cur = [x for x in page if x.get("congress") == CONGRESS and x.get("type") and x.get("number")
               and not x.get("amendmentNumber")]
        out += [row(x) for x in cur]
        # Results come newest first; stop once a page reaches into earlier Congresses.
        if any((x.get("congress") or 0) < CONGRESS for x in page) or len(page) < 250 or len(out) >= cap:
            break
        offset += 250
        time.sleep(0.3)
    total = len(out)
    out.sort(key=lambda b: (b["introduced"] or "", int(b["number"]) if b["number"].isdigit() else 0), reverse=True)
    return out[:cap], total


def main():
    if not KEY:
        print("No CONGRESS_API_KEY; skipping bills."); return
    path = D("raw", "bills.json")
    old = {}
    if os.path.exists(path):
        old = json.load(open(path, encoding="utf-8"))
        age = datetime.now(timezone.utc) - datetime.fromisoformat(old.get("updated", "2000-01-01T00:00+00:00"))
        if age.total_seconds() < 20 * 3600 and "--force" not in sys.argv:
            print(f"Bills fetched {age} ago; skipping."); return
    roster = json.load(open(D("senators.json"), encoding="utf-8"))["senators"]
    members, failed = {}, []
    for s in roster:
        bio = s["bioguide"]
        try:
            sp, sp_n = fetch(bio, "sponsored", 1000)
            co, co_n = fetch(bio, "cosponsored", MAX_COSPONSORED)
            members[bio] = {"sponsored": sp, "cosponsored": co, "sponsored_total": sp_n,
                            "cosponsored_total": co_n, "capped": co_n >= MAX_COSPONSORED}
        except Exception as e:  # keep the last good copy for this senator
            failed.append(bio); print(f"  failed {bio}: {e}")
            if bio in old.get("members", {}):
                members[bio] = old["members"][bio]
    if not members or len(failed) > len(roster) // 2:
        print(f"Too many failures ({len(failed)}); keeping previous bills.json"); return
    os.makedirs(D("raw"), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "congress": CONGRESS,
                   "members": members}, f, separators=(",", ":"))
    n = sum(len(m["sponsored"]) for m in members.values())
    print(f"Bills: {len(members)} senators, {n} sponsored; {len(failed)} failed")


if __name__ == "__main__":
    main()
