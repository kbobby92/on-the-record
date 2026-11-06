"""Collect recent government and politics news into data/news.json.

Three kinds of items:
  news      headlines from a balanced set of outlets (data/news_sources.json); headline + link only
  official  actions from Congress.gov (bills passed, laws signed, vetoes) - needs CONGRESS_API_KEY
  vote      Senate roll calls from data/raw/votes.json (passage votes, confirmations)

Every item is tagged with the senators (and senators-elect) it mentions. Stories several outlets
cover are grouped together. Items older than KEEP_DAYS are dropped.
"""
import calendar, json, os, re, time, unicodedata
from datetime import datetime, timedelta, timezone

import feedparser
import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)
KEEP_DAYS = 7
MAX_ITEMS = 400
UA = "Mozilla/5.0 (compatible; on-the-record news reader; +https://github.com/kbobby92/on-the-record)"
CONGRESS_KEY = os.environ.get("CONGRESS_API_KEY")

# Words that mark an item as being about government. Feeds marked "filter" must match one of
# these or mention a senator to be kept.
GOV = re.compile(r"\b(senat\w*|congress\w*|house (republicans|democrats|speaker|vote|passes|panel|committee)|"
                 r"lawmakers?|legislat\w+|bill|filibuster|cloture|appropriations?|shutdown|budget|"
                 r"white house|president|administration|cabinet|nominee|nomination|confirm\w*|veto\w*|"
                 r"supreme court|justice department|attorney general|federal|governor|election|midterm|"
                 r"ballot|campaign|impeach\w*|executive order|tariff\w*|speaker|caucus|gop|democrat\w*|republican\w*)\b", re.I)
OFFICIAL_ACTION = re.compile(r"Became Public Law|Signed by President|Vetoed|Passed Senate|Passed House|"
                             r"Passed/agreed to in (Senate|House)|Resolution agreed to in Senate|Presented to President|"
                             r"Veto message|Failed of passage|Cloture", re.I)
KEY_VOTE = re.compile(r"Bill Passed|Bill Defeated|Nomination Confirmed|Nomination Rejected|Joint Resolution (Passed|Defeated)|"
                      r"Veto (Sustained|Overridden)|Resolution Agreed|Conference Report Agreed", re.I)


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


# ---------- who is mentioned ----------
COMMON_LAST = {"scott", "kelly", "brown", "young", "king", "smith", "kim", "lee", "paul", "moore", "johnson", "jackson",
               "warner", "reed", "price", "graham", "collins", "kennedy", "banks", "hill", "rounds", "booker", "murphy"}


def build_matchers():
    people = []
    for s in load(D("senators.json"), {"senators": []})["senators"]:
        first = [x for x in {s.get("first"), s.get("nickname")} if x]
        names = [f"{f} {s['last']}" for f in first] + [s["name"]]
        people.append({"id": s["bioguide"], "label": s["name"], "names": names, "last": s["last"],
                       "party": {"Democrat": "D", "Republican": "R"}.get(s["party"], "I")})
    races = load(D("races.json"), {"races": {}})["races"]
    for st, r in races.items():
        w = r.get("winner")
        if w and r.get("status") in ("called", "certified") and not any(norm(w) == norm(p["label"]) for p in people):
            nom = next((n for n in r.get("nominees") or [] if norm(n.get("name")) == norm(w)), {})
            people.append({"id": f"elect:{st}", "label": w, "names": [w], "last": w.split()[-1],
                           "party": {"DEM": "D", "DFL": "D", "REP": "R"}.get(nom.get("party"), "I")})
    for p in people:
        pats = [re.escape(norm(n)) for n in p["names"]]
        ln = norm(p["last"])
        # "Sen. Kelly" / "Senator Kelly" is safe even for common names; a bare last name never is.
        pats.append(rf"(sen|senator|sens|senators)( [a-z]+){{0,3}} {re.escape(ln)}")
        p["re"] = re.compile(r"\b(" + "|".join(pats) + r")\b")
    return people


def tag(text, people):
    t = norm(text)
    return [p["id"] for p in people if p["re"].search(t)]


# ---------- sources ----------
def from_feeds(people, log):
    cfg = load(D("news_sources.json"), {"feeds": []})["feeds"]
    items = []
    for f in cfg:
        try:
            r = requests.get(f["url"], headers={"User-Agent": UA}, timeout=30)
            r.raise_for_status()
            feed = feedparser.parse(r.content)
        except Exception as e:
            log.append(f"{f['source']}: failed ({e.__class__.__name__}: {str(e)[:80]})")
            continue
        kept = 0
        for e in feed.entries[:80]:
            title = strip_html(e.get("title"))
            link = e.get("link")
            if not (title and link):
                continue
            ts = e.get("published_parsed") or e.get("updated_parsed")
            when = datetime.fromtimestamp(calendar.timegm(ts), timezone.utc) if ts else datetime.now(timezone.utc)
            summary = strip_html(e.get("summary"))[:400]  # used only for matching, never published
            who = tag(f"{title}. {summary}", people)
            if f.get("filter") and not who and not GOV.search(title):
                continue
            items.append({"kind": "news", "title": title, "url": link, "source": f["source"],
                          "published": when.isoformat(timespec="minutes"), "senators": who})
            kept += 1
        log.append(f"{f['source']}: {len(feed.entries)} items, {kept} kept")
    return items


BILL_PATH = {"HR": "house-bill", "S": "senate-bill", "HJRES": "house-joint-resolution", "SJRES": "senate-joint-resolution",
             "HRES": "house-resolution", "SRES": "senate-resolution", "HCONRES": "house-concurrent-resolution",
             "SCONRES": "senate-concurrent-resolution"}
BILL_NAME = {"HR": "H.R.", "S": "S.", "HJRES": "H.J.Res.", "SJRES": "S.J.Res.", "HRES": "H.Res.", "SRES": "S.Res.",
             "HCONRES": "H.Con.Res.", "SCONRES": "S.Con.Res."}


def from_congress(people, log):
    if not CONGRESS_KEY:
        log.append("Congress.gov: skipped (no CONGRESS_API_KEY)")
        return []
    since = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).strftime("%Y-%m-%dT00:00:00Z")
    items, offset = [], 0
    while offset < 1000:
        try:
            r = requests.get("https://api.congress.gov/v3/bill", timeout=60, params={
                "format": "json", "api_key": CONGRESS_KEY, "fromDateTime": since, "sort": "updateDate+desc",
                "limit": 250, "offset": offset})
            r.raise_for_status()
            bills = r.json().get("bills", [])
        except Exception as e:
            log.append(f"Congress.gov: failed ({str(e).replace(CONGRESS_KEY, '***')[:100]})")
            break
        for b in bills:
            la = b.get("latestAction") or {}
            text, date = la.get("text", ""), la.get("actionDate", "")
            if not OFFICIAL_ACTION.search(text) or date < since[:10]:
                continue
            t = (b.get("type") or "").upper()
            name = f"{BILL_NAME.get(t, t)} {b.get('number')}"
            title = f"{name}: {strip_html(text).rstrip('.')}. ({b.get('title', '').strip()})"
            url = f"https://www.congress.gov/bill/{b.get('congress')}th-congress/{BILL_PATH.get(t, 'bill')}/{b.get('number')}"
            items.append({"kind": "official", "title": title[:300], "url": url, "source": "Congress.gov",
                          "published": f"{date}T12:00+00:00", "senators": tag(b.get("title", ""), people), "bill": name})
        if len(bills) < 250:
            break
        offset += 250
        time.sleep(0.5)
    log.append(f"Congress.gov: {len(items)} actions")
    return items


def from_votes(people, log):
    votes = load(D("raw", "votes.json"), {"votes": {}})["votes"]
    since = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).date().isoformat()
    items = []
    for v in votes.values():
        if v["date"] < since or not KEY_VOTE.search(v.get("result", "")):
            continue
        c = v.get("counts", {})
        bill = v["document"].get("name") or ""
        title = f"Senate vote: {v['result']}, {c.get('yeas')}–{c.get('nays')}. {bill + ': ' if bill else ''}{v.get('title', '')}"
        items.append({"kind": "vote", "title": title[:300], "url": v["source"], "source": "U.S. Senate",
                      "published": f"{v['date']}T20:00+00:00", "senators": [], "bill": bill, "vote_id": v["id"]})
    log.append(f"Senate votes: {len(items)} key votes")
    return items


# ---------- grouping ----------
STOP = set("a an the and or of to in on for with at by from as is are was were be after over amid says say new".split())


def words(t):
    return {w for w in norm(t).split() if w not in STOP and len(w) > 2}


def cluster(items):
    """Group headlines from different outlets about the same story (very similar wording, within 36 hours)."""
    items.sort(key=lambda x: x["published"], reverse=True)
    out = []
    for it in items:
        if it["kind"] != "news":
            out.append(it)
            continue
        w = words(it["title"])
        home = None
        for o in out:
            if o["kind"] != "news" or o["source"] == it["source"] or any(a["source"] == it["source"] for a in o.get("also", [])):
                continue
            dt = abs(datetime.fromisoformat(o["published"]) - datetime.fromisoformat(it["published"]))
            ow = words(o["title"])
            if dt < timedelta(hours=36) and w and ow and len(w & ow) / len(w | ow) >= 0.45:
                home = o
                break
        if home:
            home.setdefault("also", []).append({"source": it["source"], "url": it["url"]})
            home["senators"] = sorted(set(home["senators"]) | set(it["senators"]))
        else:
            out.append(it)
    return out


def main():
    log = []
    people = build_matchers()
    old = load(D("news.json"), {"items": []})["items"]
    fresh = from_feeds(people, log) + from_congress(people, log) + from_votes(people, log)
    seen, merged = set(), []
    for it in fresh + old:  # fresh first so updated tagging wins
        key = it["url"]
        if key in seen:
            continue
        seen.add(key)
        for a in it.get("also", []):
            seen.add(a["url"])
        merged.append({k: v for k, v in it.items() if k != "also"} | ({"also": it["also"]} if it.get("also") else {}))
    cutoff = (datetime.now(timezone.utc) - timedelta(days=KEEP_DAYS)).isoformat()
    merged = [m for m in merged if m["published"] >= cutoff[:16]]
    # Re-tag stored items too, so senators-elect added after a story ran still get linked.
    for m in merged:
        if m["kind"] != "vote":
            m["senators"] = sorted(set(m.get("senators", [])) | set(tag(m["title"], people)))
    items = cluster(merged)[:MAX_ITEMS]
    names = {p["id"]: p["label"] for p in people}
    with open(D("news.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": datetime.now(timezone.utc).isoformat(timespec="minutes"), "names": names,
                   "parties": {p["id"]: p["party"] for p in people},
                   "sources": [x["source"] for x in load(D("news_sources.json"), {"feeds": []})["feeds"]],
                   "items": items}, f, separators=(",", ":"))
    print("\n".join(log))
    print(f"{len(items)} items kept ({sum(1 for i in items if i['senators'])} mention a senator)")


if __name__ == "__main__":
    main()
