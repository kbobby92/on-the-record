"""Download House roll-call votes for the current Congress into data/raw/house_votes.json.

Sources, tried in order:
  1. The House Clerk's official roll-call XML (clerk.house.gov/evs/<year>/rollNNN.xml), keyed by bioguide ID
  2. Voteview (voteview.com, UCLA), which republishes every roll call and lags by a few days

Stored compactly so the file stays small: one list of member IDs, and for each vote a string with one
character per member in that order: Y yes, N no, P present, V didn't vote, O other (e.g. a Speaker vote),
"." not a member at the time. Already-downloaded votes are kept, so each run only adds new ones.
Bill summaries from the Congressional Research Service are added when CONGRESS_API_KEY is set.
"""
import csv, io, json, os, re, sys, time
import xml.etree.ElementTree as ET
from datetime import date, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_votes import get, Blocked, crs_summary, current_congress, CONGRESS_KEY  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "house_votes.json")
ROSTER = os.path.join(ROOT, "data", "house.json")
EVS = "https://clerk.house.gov/evs/{year}/roll{n:03d}.xml"
VV = "https://voteview.com/static/data/out/{kind}/H{c}_{kind}.csv"
CAST = {"Yea": "Y", "Aye": "Y", "Nay": "N", "No": "N", "Present": "P", "Not Voting": "V"}
VV_CAST = {1: "Y", 2: "Y", 3: "Y", 4: "N", 5: "N", 6: "N", 7: "P", 8: "V", 9: "V"}
LEGIS = [("H J RES", "H.J.Res."), ("S J RES", "S.J.Res."), ("H CON RES", "H.Con.Res."), ("S CON RES", "S.Con.Res."),
         ("H RES", "H.Res."), ("S RES", "S.Res."), ("H R", "H.R."), ("S", "S.")]
VV_BILL = {"HR": "H.R.", "S": "S.", "HJRES": "H.J.Res.", "SJRES": "S.J.Res.", "HCONRES": "H.Con.Res.",
           "SCONRES": "S.Con.Res.", "HRES": "H.Res.", "SRES": "S.Res."}


def doc_from_legis(txt):
    txt = re.sub(r"\s+", " ", (txt or "").upper().replace(".", " ")).strip()
    for pre, name in LEGIS:
        m = re.match(rf"^{pre} (\d+)$", txt)
        if m:
            return {"type": name, "number": m.group(1), "name": f"{name} {m.group(1)}", "title": ""}
    return {"type": "", "number": "", "name": "", "title": ""}


def pack(positions, members):
    for b in positions:
        if b not in members:
            members.append(b)
    return "".join(positions.get(b, ".") for b in members)


def from_clerk(congress, store):
    first_year = 1789 + 2 * (congress - 1)
    new = 0
    for session, year in ((1, first_year), (2, first_year + 1)):
        if year > date.today().year:
            break
        n, misses = 0, 0
        while misses < 3:
            n += 1
            vid = f"{congress}-{session}-{n}"
            if vid in store["votes"]:
                misses = 0
                continue
            raw = get(EVS.format(year=year, n=n))
            if not raw:
                misses += 1
                continue
            try:
                v = ET.fromstring(raw)
            except ET.ParseError:
                misses += 1
                continue
            md = v.find("vote-metadata")
            if md is None:
                misses += 1
                continue
            misses = 0
            g = lambda p: (md.findtext(p) or "").strip()
            try:
                when = datetime.strptime(g("action-date"), "%d-%b-%Y").strftime("%Y-%m-%d")
            except ValueError:
                when = g("action-date")
            pos = {}
            for rv in v.iter("recorded-vote"):
                leg = rv.find("legislator")
                bid = leg.get("name-id") if leg is not None else None
                if bid:
                    pos[bid] = CAST.get((rv.findtext("vote") or "").strip(), "O")
            tot = md.find("vote-totals/totals-by-vote")
            tg = lambda p: (tot.findtext(p) or "").strip() if tot is not None else ""
            store["votes"][vid] = {
                "id": vid, "congress": congress, "session": session, "number": n, "date": when,
                "question": g("vote-question"), "title": g("vote-desc"), "result": g("vote-result"),
                "type": g("vote-type"), "document": doc_from_legis(g("legis-num")),
                "counts": {"yeas": tg("yea-total"), "nays": tg("nay-total"), "present": tg("present-total"), "absent": tg("not-voting-total")},
                "pos": pack(pos, store["members"]),
                "source": f"https://clerk.house.gov/Votes/{year}{n}",
            }
            new += 1
            time.sleep(0.2)
        print(f"Clerk: {year}: through roll {n - misses}")
    return new


def from_voteview(congress, store):
    def table(kind):
        raw = get(VV.format(kind=kind, c=congress))
        if not raw:
            raise Blocked(f"Voteview has no House {kind} file for Congress {congress}")
        return list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))
    members = {r["icpsr"]: r["bioguide_id"] for r in table("members") if r.get("bioguide_id")}
    casts = {}
    for r in table("votes"):
        b = members.get(r["icpsr"])
        if b:
            casts.setdefault(r["rollnumber"], {})[b] = VV_CAST.get(int(float(r["cast_code"])), "O")
    new = 0
    first_year = 1789 + 2 * (congress - 1)
    for rc in table("rollcalls"):
        session = int(rc.get("session") or 1)
        number = int(float(rc.get("clerk_rollnumber") or rc["rollnumber"]))
        vid = f"{congress}-{session}-{number}"
        if vid in store["votes"]:
            continue
        m = re.match(r"^([A-Z]+)(\d+)$", (rc.get("bill_number") or "").replace(" ", "").upper())
        doc = {"type": "", "number": "", "name": "", "title": ""}
        if m and m.group(1) in VV_BILL:
            doc = {"type": VV_BILL[m.group(1)], "number": m.group(2), "name": f"{VV_BILL[m.group(1)]} {m.group(2)}", "title": ""}
        store["votes"][vid] = {
            "id": vid, "congress": congress, "session": session, "number": number, "date": rc.get("date", ""),
            "question": rc.get("vote_question", ""), "title": rc.get("vote_desc") or rc.get("dtl_desc", ""),
            "result": rc.get("vote_result", ""), "type": "", "document": doc,
            "counts": {"yeas": rc.get("yea_count", ""), "nays": rc.get("nay_count", ""), "present": "", "absent": ""},
            "pos": pack(casts.get(rc["rollnumber"], {}), store["members"]),
            "source": f"https://clerk.house.gov/Votes/{first_year + session - 1}{number}",
            "via": "voteview",
        }
        new += 1
    return new


def main():
    store = {"members": [], "votes": {}, "summaries": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            store = json.load(f)
    congress = current_congress()
    try:
        new = from_clerk(congress, store)
    except Blocked as e:
        print(f"clerk.house.gov unavailable ({e}); using Voteview instead")
        new = from_voteview(congress, store)
    if CONGRESS_KEY:
        bills = {(v["congress"], v["document"]["type"], v["document"]["number"])
                 for v in store["votes"].values() if v["document"]["number"]}
        for c, dt, dn in sorted(bills):
            crs_summary(c, dt, dn, store["summaries"])
        print(f"{sum(1 for x in store['summaries'].values() if x)} House bill summaries on file")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(store, f, separators=(",", ":"))
    print(f"House: added {new} new votes; {len(store['votes'])} total; {len(store['members'])} members seen")


if __name__ == "__main__":
    main()
