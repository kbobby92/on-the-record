"""Download Senate roll-call votes for the current Congress into data/raw/votes.json.

Source: official XML published by the U.S. Senate (senate.gov). Already-downloaded
votes are kept, so each daily run only fetches new ones.

Optional: set CONGRESS_API_KEY (free from api.congress.gov) to attach the
Congressional Research Service's neutral plain-English summary for each bill voted on.
"""
import json, os, re, sys, time, urllib.request, urllib.error
import xml.etree.ElementTree as ET
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "votes.json")
UA = {"User-Agent": "Mozilla/5.0 (compatible; on-the-record open-data project)"}
MENU = "https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_{c}_{s}.xml"
VOTE = "https://www.senate.gov/legislative/LIS/roll_call_votes/vote{c}{s}/vote_{c}_{s}_{n}.xml"
CONGRESS_KEY = os.environ.get("CONGRESS_API_KEY")

# Senate document type -> congress.gov bill type
BILL_TYPES = {"H.R.": "hr", "S.": "s", "H.J.Res.": "hjres", "S.J.Res.": "sjres",
              "H.Con.Res.": "hconres", "S.Con.Res.": "sconres", "H.Res.": "hres", "S.Res.": "sres"}
CAST = {"Yea": "Y", "Guilty": "Y", "Nay": "N", "Not Guilty": "N", "Present": "P",
        "Not Voting": "NV", "Present, Giving Live Pair": "P"}


def get(url, tries=3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 * (i + 1))
        except Exception:
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"failed: {url}")


def t(el, path):
    x = el.find(path)
    return (x.text or "").strip() if x is not None and x.text else ""


def current_congress(today=None):
    y = (today or date.today()).year
    return (y - 1789) // 2 + 1


def crs_summary(congress, doc_type, doc_number, cache):
    key = f"{congress}-{doc_type}-{doc_number}"
    if cache.get(key):
        return cache[key]
    btype = BILL_TYPES.get(doc_type)
    if not (CONGRESS_KEY and btype and doc_number.isdigit()):
        return None
    url = (f"https://api.congress.gov/v3/bill/{congress}/{btype}/{doc_number}/summaries"
           f"?format=json&api_key={CONGRESS_KEY}")
    try:
        data = json.loads(get(url) or b"{}")
        items = data.get("summaries") or []
        if not items:
            return None  # CRS often publishes later; retry on a future run
        latest = sorted(items, key=lambda s: s.get("updateDate", ""))[-1]
        text = re.sub(r"<[^>]+>", " ", latest.get("text", ""))
        text = re.sub(r"\s+", " ", text).strip()
        cache[key] = {"text": text[:1500], "version": latest.get("actionDesc"),
                      "url": f"https://www.congress.gov/bill/{congress}th-congress/"
                             f"{'senate' if btype.startswith('s') else 'house'}-"
                             f"{ {'hr':'bill','s':'bill','hjres':'joint-resolution','sjres':'joint-resolution','hconres':'concurrent-resolution','sconres':'concurrent-resolution','hres':'resolution','sres':'resolution'}[btype] }/{doc_number}"}
    except Exception as e:
        print("summary failed", key, e)
        return None
    return cache[key]


def main():
    store = {"votes": {}, "summaries": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            store = json.load(f)
    congress = current_congress()
    new = 0
    for session in (1, 2):
        raw = get(MENU.format(c=congress, s=session))
        if not raw:
            print(f"No vote menu for {congress}-{session} (yet)")
            continue
        menu = ET.fromstring(raw)
        numbers = [t(v, "vote_number") for v in menu.iter("vote")]
        print(f"{congress}-{session}: {len(numbers)} votes listed")
        for n in numbers:
            vid = f"{congress}-{session}-{int(n)}"
            if vid in store["votes"]:
                continue
            x = get(VOTE.format(c=congress, s=session, n=n.zfill(5)))
            if not x:
                continue
            v = ET.fromstring(x)
            when = t(v, "vote_date")
            try:
                when = datetime.strptime(when, "%B %d, %Y, %I:%M %p").strftime("%Y-%m-%d")
            except ValueError:
                pass
            doc_type, doc_num = t(v, "document/document_type"), t(v, "document/document_number")
            store["votes"][vid] = {
                "id": vid, "congress": congress, "session": session, "number": int(n),
                "date": when,
                "question": t(v, "vote_question_text") or t(v, "question"),
                "title": t(v, "vote_title"),
                "result": t(v, "vote_result_text") or t(v, "vote_result"),
                "document": {"type": doc_type, "number": doc_num,
                             "name": t(v, "document/document_name"),
                             "title": t(v, "document/document_title")},
                "amendment": t(v, "amendment/amendment_number"),
                "counts": {k: t(v, f"count/{k}") for k in ("yeas", "nays", "present", "absent")},
                "positions": {t(m, "lis_member_id"): CAST.get(t(m, "vote_cast"), t(m, "vote_cast"))
                              for m in v.iter("member")},
                "source": VOTE.format(c=congress, s=session, n=n.zfill(5)),
            }
            new += 1
            time.sleep(0.3)  # be polite to senate.gov
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
