"""Download senators' stock trades (STOCK Act Periodic Transaction Reports)
into data/raw/trades.json.

Source: the Senate's official Electronic Financial Disclosure site (efdsearch.senate.gov).
Only electronically filed reports can be parsed; scanned paper filings are listed with
a link but no line items. Already-parsed reports are kept, so daily runs only add new ones.

Optional: set SEC_USER_AGENT (e.g. "On the Record yourname@example.com", as the SEC
requires) to look up each company's industry code, used for committee-overlap flags.
"""
import json, os, re, sys, time
from datetime import datetime

import requests
from bs4 import BeautifulSoup

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "raw", "trades.json")
BASE = "https://efdsearch.senate.gov"
START_DATE = "01/01/2023 00:00:00"   # how far back to collect
SEC_UA = os.environ.get("SEC_USER_AGENT")


def session():
    """Accept the site's usage agreement and return (session, csrf token)."""
    s = requests.Session()
    s.headers["User-Agent"] = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
                               "Chrome/126.0 Safari/537.36")
    home = s.get(BASE + "/search/home/", timeout=60)
    home.raise_for_status()
    form_token = BeautifulSoup(home.text, "html.parser").find(
        attrs={"name": "csrfmiddlewaretoken"})["value"]
    print("cookies after GET:", list(s.cookies.keys()), "| GET status", home.status_code)
    r = s.post(BASE + "/search/home/", timeout=60,
               data={"csrfmiddlewaretoken": form_token, "prohibition_agreement": "1"},
               headers={"Referer": BASE + "/search/home/", "Origin": BASE,
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    if r.status_code != 200:
        snippet = " ".join(BeautifulSoup(r.text, "html.parser").get_text(" ").split())[:400]
        print("agreement POST status", r.status_code, "| server said:", snippet)
        print("response headers:", {k: v for k, v in r.headers.items() if k.lower() in ("server", "x-frame-options", "content-type", "set-cookie")})
    r.raise_for_status()
    token = s.cookies.get("csrftoken") or s.cookies.get("csrf") or form_token
    return s, token


def list_reports(s, token):
    rows, start = [], 0
    while True:
        r = s.post(BASE + "/search/report/data/", timeout=60,
                   headers={"Referer": BASE + "/search/", "X-CSRFToken": token,
                            "X-Requested-With": "XMLHttpRequest"},
                   data={"start": str(start), "length": "100", "report_types": "[11]",
                         "filer_types": "[1]", "submitted_start_date": START_DATE,
                         "submitted_end_date": "", "candidate_state": "",
                         "senator_state": "", "office_id": "", "first_name": "",
                         "last_name": "", "draw": "1", "csrfmiddlewaretoken": token})
        r.raise_for_status()
        data = r.json().get("data", [])
        rows += data
        if len(data) < 100:
            return rows
        start += 100
        time.sleep(0.5)


def parse_ptr(s, path):
    html = s.get(BASE + path, timeout=60).text
    table = BeautifulSoup(html, "html.parser").find("table")
    if not table:
        return []
    out = []
    for tr in table.find("tbody").find_all("tr"):
        c = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
        if len(c) < 8:
            continue
        ticker = c[3] if c[3] not in ("--", "") else None
        try:
            tdate = datetime.strptime(c[1], "%m/%d/%Y").strftime("%Y-%m-%d")
        except ValueError:
            tdate = None
        out.append({"date": tdate, "owner": c[2], "ticker": ticker, "asset": c[4],
                    "asset_type": c[5], "type": c[6], "amount": c[7],
                    "comment": c[8] if len(c) > 8 and c[8] != "--" else None})
    return out


def sec_sic(tickers, cache):
    """Map tickers to SEC industry (SIC) codes. Needs SEC_USER_AGENT."""
    if not SEC_UA:
        return
    h = {"User-Agent": SEC_UA}
    try:
        idx = requests.get("https://www.sec.gov/files/company_tickers.json", headers=h, timeout=60).json()
    except Exception as e:
        print("SEC ticker list failed:", e)
        return
    cik = {v["ticker"].upper(): str(v["cik_str"]).zfill(10) for v in idx.values()}
    for tk in sorted(tickers):
        if tk in cache or tk.upper() not in cik:
            continue
        try:
            sub = requests.get(f"https://data.sec.gov/submissions/CIK{cik[tk.upper()]}.json",
                               headers=h, timeout=60).json()
            cache[tk] = {"sic": sub.get("sic"), "industry": sub.get("sicDescription")}
        except Exception:
            pass
        time.sleep(0.15)  # SEC asks for <10 requests/sec


def main():
    store = {"reports": {}, "industries": {}}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            store = json.load(f)
    s, token = session()
    rows = list_reports(s, token)
    print(f"{len(rows)} periodic transaction reports listed")
    new = 0
    for first, last, office, link, received in rows:
        m = re.search(r'href="([^"]+)"', link)
        if not m:
            continue
        path = m.group(1)
        if path in store["reports"]:
            continue
        rep = {"first": first.strip(), "last": last.strip(), "office": office,
               "received": datetime.strptime(received, "%m/%d/%Y").strftime("%Y-%m-%d"),
               "url": BASE + path, "paper": "/paper/" in path,
               "title": BeautifulSoup(link, "html.parser").get_text(strip=True),
               "transactions": []}
        if not rep["paper"]:
            try:
                rep["transactions"] = parse_ptr(s, path)
            except Exception as e:
                print("parse failed", path, e)
                continue
            time.sleep(0.4)
        store["reports"][path] = rep
        new += 1
    tickers = {t["ticker"] for r in store["reports"].values() for t in r["transactions"] if t["ticker"]}
    sec_sic(tickers, store["industries"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(store, f, separators=(",", ":"))
    print(f"Added {new} reports; {len(store['reports'])} total; {len(store['industries'])} tickers classified")


if __name__ == "__main__":
    main()
