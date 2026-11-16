"""Build data/senators.json and data/house.json: current Senate and House rosters with committees and IDs.

The House file covers the 435 voting members (non-voting delegates are left out for now).

Source: the open unitedstates/congress-legislators dataset (public domain).
Usage:  python scripts/fetch_roster.py            # downloads from GitHub
        python scripts/fetch_roster.py --local DIR # uses already-downloaded YAML files
"""
import argparse, json, os, sys, urllib.request
from datetime import date, datetime, timezone

import yaml

BASE = "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/"
FILES = ["legislators-current.yaml", "committees-current.yaml",
         "committee-membership-current.yaml", "legislators-social-media.yaml"]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "senators.json")
OUT_HOUSE = os.path.join(ROOT, "data", "house.json")
DELEGATES = {"DC", "PR", "GU", "VI", "AS", "MP"}


def load(name, local):
    if local:
        with open(os.path.join(local, name), encoding="utf-8") as f:
            return yaml.safe_load(f)
    with urllib.request.urlopen(BASE + name, timeout=60) as r:
        return yaml.safe_load(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--local")
    args = ap.parse_args()

    legislators = load(FILES[0], args.local)
    committees = load(FILES[1], args.local)
    membership = load(FILES[2], args.local)
    social = load(FILES[3], args.local)

    # Committee names, including subcommittees ("SSAF13" = parent + sub id).
    cnames = {}
    for c in committees:
        if c.get("type") not in ("senate", "house"):
            continue
        cnames[c["thomas_id"]] = {"name": c["name"], "parent": None, "url": c.get("url")}
        for s in c.get("subcommittees", []) or []:
            cnames[c["thomas_id"] + s["thomas_id"]] = {"name": s["name"], "parent": c["name"], "url": None}

    by_member = {}
    for cid, members in membership.items():
        if cid not in cnames:
            continue
        for m in members:
            by_member.setdefault(m["bioguide"], []).append({
                "id": cid,
                "name": cnames[cid]["name"],
                "parent": cnames[cid]["parent"],
                "title": m.get("title"),
                "rank": m.get("rank"),
            })

    soc = {s["id"]["bioguide"]: s.get("social", {}) for s in social}

    senators = []
    for p in legislators:
        term = p["terms"][-1]
        if term["type"] != "sen":
            continue
        ids = p["id"]
        first_sen = next(t for t in p["terms"] if t["type"] == "sen")
        end = term["end"]
        comms = [c for c in by_member.get(ids["bioguide"], []) if c["id"].startswith("S")]
        senators.append({
            "bioguide": ids["bioguide"],
            "lis": ids.get("lis"),
            "fec": ids.get("fec", []),
            "name": p["name"].get("official_full") or f'{p["name"]["first"]} {p["name"]["last"]}',
            "last": p["name"]["last"],
            "first": p["name"]["first"],
            "nickname": p["name"].get("nickname"),
            "party": term.get("party"),
            "caucus": term.get("caucus"),
            "state": term["state"],
            "class": term.get("class"),
            "rank": term.get("state_rank"),
            "serving_since": first_sen["start"],
            "term_end": end,
            "next_election": int(end[:4]) - 1 if end[5:7] == "01" else int(end[:4]),
            "website": term.get("url"),
            "contact_form": term.get("contact_form"),
            "phone": term.get("phone"),
            "office": term.get("address"),
            "x_handle": soc.get(ids["bioguide"], {}).get("twitter"),
            "photo": f'https://unitedstates.github.io/images/congress/225x275/{ids["bioguide"]}.jpg',
            "committees": sorted([c for c in comms if not c["parent"]], key=lambda c: c["name"]),
            "subcommittees": sorted([c for c in comms if c["parent"]], key=lambda c: (c["parent"], c["name"])),
        })

    house = []
    for p in legislators:
        term = p["terms"][-1]
        if term["type"] != "rep" or term["state"] in DELEGATES:
            continue
        ids = p["id"]
        # First day of the current unbroken run of House terms
        reps = [t for t in p["terms"] if t["type"] == "rep"]
        since = reps[-1]["start"]
        for prev, cur in zip(reversed(reps[:-1]), reversed(reps)):
            if prev["end"][:4] in (cur["start"][:4], str(int(cur["start"][:4]) - 1)) or prev["end"][:7] == cur["start"][:7]:
                since = prev["start"]
            else:
                break
        end = term["end"]
        comms = [c for c in by_member.get(ids["bioguide"], []) if c["id"].startswith("H")]
        dist = int(term.get("district") or 0)
        house.append({
            "bioguide": ids["bioguide"],
            "fec": ids.get("fec", []),
            "name": p["name"].get("official_full") or f'{p["name"]["first"]} {p["name"]["last"]}',
            "last": p["name"]["last"],
            "first": p["name"]["first"],
            "nickname": p["name"].get("nickname"),
            "party": term.get("party"),
            "caucus": term.get("caucus"),
            "state": term["state"],
            "district": dist,
            "seat": f'{term["state"]}-{"AL" if dist == 0 else dist}',
            "serving_since": since,
            "term_end": end,
            "next_election": int(end[:4]) - 1 if end[5:7] == "01" else int(end[:4]),
            "website": term.get("url"),
            "contact_form": term.get("contact_form"),
            "phone": term.get("phone"),
            "office": term.get("address"),
            "x_handle": soc.get(ids["bioguide"], {}).get("twitter"),
            "photo": f'https://unitedstates.github.io/images/congress/225x275/{ids["bioguide"]}.jpg',
            "committees": sorted([c for c in comms if not c["parent"]], key=lambda c: c["name"]),
            "subcommittees": sorted([c for c in comms if c["parent"]], key=lambda c: (c["parent"], c["name"])),
        })
    house.sort(key=lambda s: (s["state"], s["district"]))

    senators.sort(key=lambda s: (s["state"], s["last"]))
    if len(senators) < 95:
        sys.exit(f"Only {len(senators)} senators parsed; refusing to overwrite.")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "source": "github.com/unitedstates/congress-legislators",
                   "senators": senators}, f, indent=1)
    print(f"Wrote {len(senators)} senators to {OUT}")
    if len(house) < 400:
        sys.exit(f"Only {len(house)} representatives parsed; refusing to overwrite.")
    with open(OUT_HOUSE, "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"),
                   "source": "github.com/unitedstates/congress-legislators",
                   "members": house}, f, indent=1)
    print(f"Wrote {len(house)} representatives to {OUT_HOUSE}")


if __name__ == "__main__":
    main()
