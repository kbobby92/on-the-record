"""Collect federal lobbying disclosures into data/raw/lobbying.json.

Source: the Lobbying Disclosure Act database (lda.gov, formerly lda.senate.gov). Free.
Optional LDA_API_KEY (register at lda.gov) raises the limit from ~15 to ~120 requests a minute.

Two things are collected, at most once a week (the reports are filed quarterly):
  bills          LD-2 lobbying reports whose "specific issues" mention a bill on an issue page
  contributions  LD-203 reports: political contributions lobbyists report giving to or honoring
                 a sitting senator
"""
import json, os, re, sys, time
from datetime import date, datetime, timedelta, timezone

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)
OUT = D("raw", "lobbying.json")
BASES = ["https://lda.gov/api/v1", "https://lda.senate.gov/api/v1"]
KEY = os.environ.get("LDA_API_KEY")
YEARS = [date.today().year - 1, date.today().year]
REFRESH_DAYS = 6
MAX_PAGES = 40          # per query; 25 results a page
PAUSE = 0.6 if KEY else 4.2


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


class Api:
    def __init__(self, log):
        self.s = requests.Session()
        self.s.headers["User-Agent"] = "on-the-record (github.com/kbobby92/on-the-record)"
        if KEY:
            self.s.headers["Authorization"] = f"Token {KEY}"
        self.base, self.log = None, log
        for b in BASES:
            try:
                r = self.s.get(b + "/filings/", params={"filing_year": YEARS[-1], "page_size": 1}, timeout=60)
                if r.ok and "results" in r.json():
                    self.base = b
                    break
                log.append(f"{b}: HTTP {r.status_code}")
            except Exception as e:
                log.append(f"{b}: {e.__class__.__name__}")
        if not self.base:
            raise SystemExit("Lobbying API unreachable from here:\n" + "\n".join(log))
        log.append(f"Using {self.base} ({'with' if KEY else 'without'} API key)")

    def pages(self, path, params):
        url, params, n = self.base + path, dict(params, page_size=25), 0
        while url and n < MAX_PAGES:
            for attempt in range(4):
                r = self.s.get(url, params=params, timeout=90)
                if r.status_code == 429:
                    time.sleep(int(r.headers.get("Retry-After", 30)) + 2)
                    continue
                r.raise_for_status()
                break
            else:
                raise RuntimeError("rate limited")
            data = r.json()
            if n == 0:
                yield {"_count": data.get("count")}
            for x in data.get("results", []):
                yield x
            url, params, n = data.get("next"), None, n + 1
            time.sleep(PAUSE)


def bill_variants(name):
    m = re.match(r"^(H\.R\.|S\.|H\.J\.Res\.|S\.J\.Res\.|H\.Res\.|S\.Res\.)\s*(\d+)$", name)
    if not m:
        return [name], re.compile(re.escape(name), re.I)
    t, n = m.groups()
    letters = t.replace(".", "")
    variants = [f"{t} {n}", f"{t}{n}", f"{letters} {n}"]
    dotted = r"\.?\s*".join(re.escape(ch) for ch in letters)
    return variants, re.compile(rf"(?<![A-Za-z]){dotted}\.?\s*{n}(?!\d)", re.I)


def money(f):
    for k in ("income", "expenses"):
        try:
            if f.get(k) not in (None, ""):
                return float(f[k]), k
        except ValueError:
            pass
    return None, None


def collect_bills(api, bills, log):
    out = {}
    for b in bills:
        variants, rx = bill_variants(b)
        seen = {}
        for v in variants:
            for y in YEARS:
                count = None
                for f in api.pages("/filings/", {"filing_specific_lobbying_issues": v, "filing_year": y}):
                    if "_count" in f:
                        count = f["_count"]
                        if count and count > 20000:   # the filter was ignored; don't page the whole database
                            log.append(f"{b}: search returned {count} reports, filter not applied; skipping")
                            break
                        continue
                    acts = [a for a in f.get("lobbying_activities", []) if rx.search(a.get("description") or "")]
                    if not acts or f["filing_uuid"] in seen:
                        continue
                    amt, kind = money(f)
                    seen[f["filing_uuid"]] = {
                        "uuid": f["filing_uuid"], "year": f.get("filing_year"), "period": f.get("filing_period_display"),
                        "client": (f.get("client") or {}).get("name"), "registrant": (f.get("registrant") or {}).get("name"),
                        "amount": amt, "amount_kind": kind, "issues": sorted({a.get("general_issue_code_display") for a in acts if a.get("general_issue_code_display")}),
                        "url": f.get("filing_document_url"), "posted": (f.get("dt_posted") or "")[:10]}
        out[b] = sorted(seen.values(), key=lambda x: (x["year"] or 0, x["posted"]), reverse=True)
        log.append(f"{b}: {len(out[b])} reports mention it")
    return out


def collect_contributions(api, roster, log):
    out = {}
    from collections import Counter
    shared = {k for k, n in Counter(x["last"].split()[-1].lower() for x in roster).items() if n > 1}
    for s in roster:
        first = {x.lower() for x in (s.get("first"), s.get("nickname")) if x}
        last = s["last"].split()[-1].lower()
        items = []
        try:
            for y in YEARS:
                for r in api.pages("/contributions/", {"contribution_honoree": s["last"].split()[-1], "filing_year": y}):
                    if "_count" in r:
                        if r["_count"] and r["_count"] > 5000:
                            log.append(f"contributions filter not applied ({r['_count']} results); skipping")
                            return out
                        continue
                    for c in r.get("contribution_items", []) or []:
                        h = (c.get("honoree_name") or "").lower()
                        named = any(f in h for f in first)
                        # "Sen. Scott" can't be told apart when two senators share a last name: require the first name then.
                        if last in h and (named or ("sen" in h and last not in shared)):
                            items.append({"date": c.get("date"), "amount": c.get("amount"), "type": c.get("contribution_type_display"),
                                          "contributor": c.get("contributor_name"), "payee": c.get("payee_name"),
                                          "honoree": c.get("honoree_name"), "registrant": (r.get("registrant") or {}).get("name"),
                                          "lobbyist": " ".join(x for x in [((r.get("lobbyist") or {}).get("first_name")),
                                                                           ((r.get("lobbyist") or {}).get("last_name"))] if x) or None,
                                          "url": r.get("filing_document_url")})
        except RuntimeError as e:
            log.append(f"contributions stopped at {s['name']}: {e}")
            break
        uniq = {(i["date"], i["amount"], i["contributor"], i["payee"], i["honoree"]): i for i in items}
        out[s["bioguide"]] = sorted(uniq.values(), key=lambda x: x.get("date") or "", reverse=True)
    log.append(f"contributions: {sum(len(v) for v in out.values())} items for {sum(1 for v in out.values() if v)} senators")
    return out


def main():
    store = load(OUT, {})
    if store.get("fetched", "") > (datetime.now(timezone.utc) - timedelta(days=REFRESH_DAYS)).isoformat() and "--force" not in sys.argv:
        print(f"Lobbying data is from {store['fetched']}; refreshing weekly, skipping")
        return
    log = []
    issues = load(D("issues.json"), {"issues": []})["issues"]
    bills = sorted({b for i in issues for b in i.get("bills", []) + i.get("vote_bills", [])})
    roster = load(D("senators.json"), {"senators": []})["senators"]
    try:
        api = Api(log)
    except SystemExit as e:
        print(e)
        return
    store["bills"] = collect_bills(api, bills, log)
    store["contributions"] = collect_contributions(api, roster, log) or store.get("contributions", {})
    store["fetched"] = datetime.now(timezone.utc).isoformat(timespec="minutes")
    store["years"] = YEARS
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(store, f, separators=(",", ":"))
    print("\n".join(log))


if __name__ == "__main__":
    main()
