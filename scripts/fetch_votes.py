"""Download Senate roll-call votes for the current Congress into data/raw/votes.json.

Sources, tried in order:
  1. senate.gov's official roll-call XML (same-day, but it sometimes blocks cloud servers)
  2. Voteview (voteview.com, UCLA), which republishes every roll call with member IDs
     and typically lags by a few days

Already-downloaded votes are kept, so each daily run only adds new ones.
Senator positions are stored by bioguide ID.

Optional: set CONGRESS_API_KEY (free from api.congress.gov) to attach the
Congressional Research Service's neutral plain-English summary for each bill voted on.
"""
import csv, io, json, os, re, time, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "votes.json")
ROSTER = os.path.join(ROOT, "data", "senators.json")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/126.0 Safari/537.36 (on-the-record open-data project)",
      "Accept": "application/xml,text/xml,text/csv,*/*"}
MENU = "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{c}_{s}.xml"
VOTE = "https://www.senate.gov/legislative/LIS/roll_call_votes/vote{c}{s}/vote_{c}_{s}_{n}.xml"
VV = "https://voteview.com/static/data/out/{kind}/S{c}_{kind}.csv"
CONGRESS_KEY = os.environ.get("CONGRESS_API_KEY")

# Bill type as Senate/display text -> congress.gov API type
BILL_TYPES = {"H.R.": "hr", "S.": "s", "H.J.Res.": "hjres", "S.J.Res.": "sjres",
              "H.Con.Res.": "hconres", "S.Con.Res.": "sconres", "H.Res.": "hres", "S.Res.": "sres"}
# Voteview writes bills like "HR1234", "SJRES12"
VV_BILL = {"HR": "H.R.", "S": "S.", "HJRES": "H.J.Res.", "SJRES": "S.J.Res.", "HCONRES": "H.Con.Res.",
           "SCONRES": "S.Con.Res.", "HRES": "H.Res.", "SRES": "S.Res.", "PN": "PN"}
CAST = {"Yea": "Y", "Guilty": "Y", "Nay": "N", "Not Guilty": "N", "Present": "P",
        "Not Voting": "NV", "Present, Giving Live Pair": "P"}
VV_CAST = {1: "Y", 2: "Y", 3: "Y", 4: "N", 5: "N", 6: "N", 7: "P", 8: "NV", 9: "NV"}


class Blocked(Exception):
    pass


def get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            last = f"HTTP {e.code}"
            if e.code in (401, 403):
                raise Blocked(f"{last} from {url}")
        except Exception as e:
            last = repr(e)
        time.sleep(3 * (i + 1))
    raise Blocked(f"{last} from {url}")


def t(el, path):
    x = el.find(path)
    return (x.text or "").strip() if x is not None and x.text else ""


def current_congress(today=None):
    return ((today or date.today()).year - 1789) // 2 + 1


def from_senate_gov(congress, store, lis_to_bio):
    new = 0
    for session in (1, 2):
        raw = get(MENU.format(c=congress, s=session))
        if not raw:
            print(f"senate.gov: no vote list for {congress}-{session} (yet)")
            continue
        numbers = [t(v, "vote_number") for v in ET.fromstring(raw).iter("vote")]
        print(f"senate.gov: {congress}-{session}: {len(numbers)} votes listed")
        for n in numbers:
            vid = f"{congress}-{session}-{int(n)}"
            if vid in store["votes"]:
                continue
            url = VOTE.format(c=congress, s=session, n=n.zfill(5))
            x = get(url)
            if not x:
                continue
            v = ET.fromstring(x)
            when = t(v, "vote_date")
            try:
                when = datetime.strptime(when, "%B %d, %Y, %I:%M %p").strftime("%Y-%m-%d")
            except ValueError:
                pass
            store["votes"][vid] = {
                "id": vid, "congress": congress, "session": session, "number": int(n), "date": when,
                "question": t(v, "vote_question_text") or t(v, "question"),
                "title": t(v, "vote_title"),
                "result": t(v, "vote_result_text") or t(v, "vote_result"),
                "document": {"type": t(v, "document/document_type"), "number": t(v, "document/document_number"),
                             "name": t(v, "document/document_name"), "title": t(v, "document/document_title")},
                "counts": {k: t(v, f"count/{k}") for k in ("yeas", "nays", "present", "absent")},
                "positions": {lis_to_bio.get(t(m, "lis_member_id"), t(m, "lis_member_id")):
                              CAST.get(t(m, "vote_cast"), t(m, "vote_cast")) for m in v.iter("member")},
                "source": url,
            }
            new += 1
            time.sleep(0.3)
    return new


def from_voteview(congress, store):
    def table(kind):
        raw = get(VV.format(kind=kind, c=congress))
        if not raw:
            raise Blocked(f"Voteview has no {kind} file for Congress {congress}")
        return list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))

    members = {r["icpsr"]: r["bioguide_id"] for r in table("members") if r.get("bioguide_id")}
    rollcalls = table("rollcalls")
    casts = {}
    for r in table("votes"):
        casts.setdefault(r["rollnumber"], {})[members.get(r["icpsr"], "icpsr:" + r["icpsr"])] = \
            VV_CAST.get(int(float(r["cast_code"])), None)
    new = 0
    for rc in rollcalls:
        session = int(rc.get("session") or 1)
        number = int(float(rc.get("clerk_rollnumber") or rc["rollnumber"]))
        vid = f"{congress}-{session}-{number}"
        if vid in store["votes"]:
            continue
        doc_type = doc_num = name = ""
        m = re.match(r"^([A-Z]+)(\d+)$", (rc.get("bill_number") or "").replace(" ", "").upper())
        if m and m.group(1) in VV_BILL:
            doc_type, doc_num = VV_BILL[m.group(1)], m.group(2)
            name = f"{doc_type} {doc_num}"
        pos = {k: v for k, v in casts.get(rc["rollnumber"], {}).items() if v}
        store["votes"][vid] = {
            "id": vid, "congress": congress, "session": session, "number": number, "date": rc.get("date", ""),
            "question": rc.get("vote_question", ""), "title": rc.get("vote_desc") or rc.get("dtl_desc", ""),
            "result": rc.get("vote_result", ""),
            "document": {"type": doc_type, "number": doc_num, "name": name, "title": ""},
            "counts": {"yeas": rc.get("yea_count", ""), "nays": rc.get("nay_count", ""),
                       "present": "", "absent": ""},
            "positions": pos,
            "source": (f"https://www.senate.gov/legislative/LIS/roll_call_votes/vote{congress}{session}/"
                       f"vote_{congress}_{session}_{str(number).zfill(5)}.htm"),
            "via": "voteview",
        }
        new += 1
    print(f"Voteview: {len(rollcalls)} roll calls listed")
    return new


def crs_summary(congress, doc_type, doc_number, cache):
    key = f"{congress}-{doc_type}-{doc_number}"
    if cache.get(key):
        return
    btype = BILL_TYPES.get(doc_type)
    if not (btype and doc_number.isdigit()):
        return
    url = (f"https://api.congress.gov/v3/bill/{congress}/{btype}/{doc_number}/summaries"
           f"?format=json&api_key={CONGRESS_KEY}")
    try:
        items = (json.loads(get(url) or b"{}").get("summaries")) or []
    except Exception as e:
        print("summary failed", key, str(e).replace(CONGRESS_KEY, "***"))
        return
    if not items:
        return  # CRS often publishes later; retried on a future run
    latest = sorted(items, key=lambda s: s.get("updateDate", ""))[-1]
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", latest.get("text", ""))).strip()
    kind = {"hr": "bill", "s": "bill", "hjres": "joint-resolution", "sjres": "joint-resolution",
            "hconres": "concurrent-resolution", "sconres": "concurrent-resolution",
            "hres": "resolution", "sres": "resolution"}[btype]
    chamber = "senate" if btype.startswith("s") else "house"
    cache[key] = {"text": text[:1500], "version": latest.get("actionDesc"),
                  "url": f"https://www.congress.gov/bill/{congress}th-congress/{chamber}-{kind}/{doc_number}"}


def main():
    store = {"votes": {}, "summaries": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            store = json.load(f)
    with open(ROSTER, encoding="utf-8") as f:
        lis_to_bio = {s["lis"]: s["bioguide"] for s in json.load(f)["senators"]}
    congress = current_congress()
    try:
        new = from_senate_gov(congress, store, lis_to_bio)
    except Blocked as e:
        print(f"senate.gov unavailable ({e}); using Voteview instead")
        new = from_voteview(congress, store)
    if CONGRESS_KEY:
        bills = {(v["congress"], v["document"]["type"], v["document"]["number"])
                 for v in store["votes"].values() if v["document"]["number"]}
        for c, dt, dn in sorted(bills):
            crs_summary(c, dt, dn, store["summaries"])
        print(f"{sum(1 for x in store['summaries'].values() if x)} bill summaries on file")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(store, f, separators=(",", ":"))
    print(f"Added {new} new votes; {len(store['votes'])} total")


if __name__ == "__main__":
    main()
