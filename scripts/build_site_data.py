"""Combine the raw data into what the website reads:
  data/index.json               one row per senator with headline numbers
  data/senators/<bioguide>.json  everything about one senator
  data/votes_recent.json        the latest roll-call votes

Every metric here is a plain count or percentage with a published rule (see the "How it works" page).
There is deliberately no combined "overall" score.
"""
import json, os, re, unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)

LATE_DAYS = 45            # STOCK Act: report no later than 45 days after a transaction
MIN_RESOLVED_PROMISES = 3  # don't show a follow-through rate on fewer than this
RESOLVED = {"kept": 1.0, "compromise": 0.5, "broken": 0.0, "stalled": 0.0}
STATUSES = ["kept", "compromise", "in_progress", "not_started", "stalled", "broken"]


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z]", "", s)


def pct(a, b):
    return round(100 * a / b, 1) if b else None


def match_senator(rep, roster, overrides):
    key = f'{rep["first"]} {rep["last"]}'.strip()
    if key in overrides:
        return overrides[key]
    last = norm(rep["last"].split(",")[0])
    cands = [s for s in roster if norm(s["last"]) == last or norm(s["last"]).endswith(last)]
    if len(cands) == 1:
        return cands[0]["bioguide"]
    first = norm(rep["first"].split()[0]) if rep["first"] else ""
    for s in cands:
        names = {norm(s.get("first")), norm(s.get("nickname") or "")}
        if first and any(n and (n.startswith(first) or first.startswith(n)) for n in names):
            return s["bioguide"]
    return None


def main():
    roster = load(D("senators.json"), {"senators": []})["senators"]
    votes = load(D("raw", "votes.json"), {"votes": {}, "summaries": {}})
    trades = load(D("raw", "trades.json"), {"reports": {}, "industries": {}})
    money = load(D("raw", "money.json"), {})
    sectors = load(D("committee_sectors.json"), {"committees": {}})["committees"]
    promises = [p for p in load(D("promises.json"), {"promises": []})["promises"] if p.get("verified")]
    statements = [s for s in load(D("statements.json"), {"statements": []})["statements"] if s.get("verified")]
    overrides = load(D("name_overrides.json"), {})
    overrides.pop("_about", None)

    by_bio = {s["bioguide"]: s for s in roster}
    vote_list = sorted(votes["votes"].values(), key=lambda v: (v["date"], v["number"]))
    summaries = votes.get("summaries", {})

    # Party majority position on each vote (independents counted with the party they caucus with).
    def bloc(s):
        return s.get("caucus") or s["party"]
    majority = {}
    for v in vote_list:
        tally = defaultdict(Counter)
        for bio, pos in v["positions"].items():
            if bio in by_bio and pos in ("Y", "N"):
                tally[bloc(by_bio[bio])][pos] += 1
        majority[v["id"]] = {p: (c.most_common(1)[0][0] if c["Y"] != c["N"] else None)
                             for p, c in tally.items()}

    # Trades grouped by senator.
    trades_by = defaultdict(list)
    unmatched = Counter()
    industries = trades.get("industries", {})
    for path, rep in trades["reports"].items():
        bid = match_senator(rep, roster, overrides)
        if not bid:
            unmatched[f'{rep["first"]} {rep["last"]}'] += 1
            continue
        if rep["paper"] or not rep["transactions"]:
            trades_by[bid].append({"paper": rep["paper"], "received": rep["received"], "url": rep["url"]})
            continue
        for t in rep["transactions"]:
            row = dict(t, received=rep["received"], url=rep["url"])
            if t["date"]:
                row["days_to_report"] = (date.fromisoformat(rep["received"]) - date.fromisoformat(t["date"])).days
            ind = industries.get(t["ticker"] or "")
            if ind:
                row["industry"] = ind.get("industry")
                row["sic"] = ind.get("sic")
            trades_by[bid].append(row)
    if unmatched:
        print("Unmatched filers (add to data/name_overrides.json if they are current senators):",
              dict(unmatched))

    os.makedirs(D("senators"), exist_ok=True)
    index = []
    for s in roster:
        bid = s["bioguide"]
        my_comms = {c["id"] for c in s["committees"]}

        # --- Votes ---
        eligible = [v for v in vote_list if bid in v["positions"]]
        cast = [v for v in eligible if v["positions"][bid] in ("Y", "N", "P")]
        with_party = against_party = 0
        breaks = []
        for v in eligible:
            pos = v["positions"][bid]
            m = majority[v["id"]].get(bloc(s))
            if pos in ("Y", "N") and m:
                if pos == m:
                    with_party += 1
                else:
                    against_party += 1
                    breaks.append(v["id"])
        recent = []
        for v in reversed(eligible[-150:]):
            doc = v["document"]
            summ = summaries.get(f'{v["congress"]}-{doc["type"]}-{doc["number"]}')
            recent.append({"id": v["id"], "date": v["date"], "question": v["question"],
                           "title": v["title"] or doc.get("title"), "result": v["result"],
                           "bill": doc.get("name"), "position": v["positions"][bid],
                           "broke_with_party": v["id"] in breaks, "source": v["source"],
                           "summary": summ})

        # --- Trades ---
        rows = trades_by.get(bid, [])
        tx = [r for r in rows if not r.get("paper")]
        dated = [r for r in tx if "days_to_report" in r]
        late = [r for r in dated if r["days_to_report"] > LATE_DAYS]
        for r in tx:
            r["late"] = r.get("days_to_report", 0) > LATE_DAYS
            sic = int(r["sic"]) if str(r.get("sic") or "").isdigit() else None
            r["committee_overlap"] = [sectors[c]["label"] for c in my_comms if c in sectors and sic and
                                      any(lo <= sic <= hi for lo, hi in sectors[c]["ranges"])]
        overlap = [r for r in tx if r["committee_overlap"]]
        tx.sort(key=lambda r: r.get("date") or "", reverse=True)

        # --- Promises & statements ---
        mine = [p for p in promises if p.get("bioguide") == bid]
        resolved = [p for p in mine if p.get("status") in RESOLVED]
        follow = (round(100 * sum(RESOLVED[p["status"]] for p in resolved) / len(resolved), 1)
                  if len(resolved) >= MIN_RESOLVED_PROMISES else None)
        said = sorted([x for x in statements if x.get("bioguide") == bid],
                      key=lambda x: x.get("date", ""), reverse=True)

        metrics = {
            "votes_eligible": len(eligible),
            "attendance": pct(len(cast), len(eligible)),
            "party_unity": pct(with_party, with_party + against_party),
            "trades": len(tx),
            "paper_reports": sum(1 for r in rows if r.get("paper")),
            "late_trades": len(late),
            "on_time": pct(len(dated) - len(late), len(dated)),
            "committee_overlap_trades": len(overlap),
            "industry_coverage": pct(sum(1 for r in tx if r.get("sic")), sum(1 for r in tx if r.get("ticker"))),
            "promises_tracked": len(mine),
            "promises_by_status": {k: sum(1 for p in mine if p.get("status") == k) for k in STATUSES},
            "follow_through": follow,
            "statements": len(said),
        }
        m = money.get(bid)
        if m:
            metrics["raised"] = m.get("receipts")

        profile = dict(s, metrics=metrics, votes=recent, trades=tx[:400],
                       paper_reports=[r for r in rows if r.get("paper")],
                       money=m, promises=mine, statements=said[:200])
        with open(D("senators", f"{bid}.json"), "w", encoding="utf-8") as f:
            json.dump(profile, f, separators=(",", ":"))

        index.append({k: s[k] for k in ("bioguide", "name", "last", "party", "caucus", "state", "class",
                                         "next_election", "term_end", "photo", "serving_since")}
                     | {"committees": [c["name"].replace("Senate Committee on ", "").replace("Senate ", "")
                                       for c in s["committees"]], "metrics": metrics})

    recent_votes = [{"id": v["id"], "date": v["date"], "question": v["question"], "title": v["title"],
                     "result": v["result"], "bill": v["document"].get("name"), "counts": v["counts"],
                     "source": v["source"]} for v in reversed(vote_list[-40:])]
    now = datetime.now(timezone.utc).isoformat(timespec="minutes")
    with open(D("index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "senators": index,
                   "totals": {"votes": len(vote_list), "trade_reports": len(trades["reports"]),
                              "money_records": len(money), "promises": len(promises),
                              "statements": len(statements)}}, f, separators=(",", ":"))
    with open(D("votes_recent.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "votes": recent_votes}, f, separators=(",", ":"))
    build_elections(roster, now)
    print(f"Built {len(index)} senator files; {len(vote_list)} votes, {len(trades['reports'])} trade reports, "
          f"{len(money)} money records, {len(promises)} verified promises, {len(statements)} verified statements")


RACE_STATUSES = {"counting", "called", "certified", "runoff", "recount"}


def build_elections(roster, now):
    """data/elections.json: each race with its status, nominees and campaign money."""
    races = load(D("races.json"), None)
    if not races:
        return
    cands = load(D("raw", "candidates.json"), {"candidates": []})
    by_id = {c["candidate_id"]: c for c in cands["candidates"]}
    by_bio = {s["bioguide"]: s for s in roster}
    out = []
    for st, r in sorted(races["races"].items()):
        status = r.get("status") if r.get("status") in RACE_STATUSES else "counting"
        if status in ("called", "certified") and not (r.get("winner") and r.get("called_by") and r.get("source_url")):
            print(f"{st}: '{status}' needs winner, called_by and source_url; showing as counting")
            status = "counting"
        nominees = []
        for n in r.get("nominees") or []:
            c = by_id.get(n.get("candidate_id") or "")
            nominees.append({"name": n.get("name") or (c or {}).get("name"), "party": n.get("party") or (c or {}).get("party"),
                             "incumbent": bool(n.get("incumbent")), "bioguide": n.get("bioguide"),
                             "receipts": (c or {}).get("receipts"), "cash_on_hand": (c or {}).get("cash_on_hand"),
                             "through": (c or {}).get("through"), "fec": (c or {}).get("source")})
        nominees.sort(key=lambda n: -(n["receipts"] or 0))
        filers = sorted([c for c in cands["candidates"] if c["state"] == st and (c.get("receipts") or 0) >= 5000],
                        key=lambda c: -(c["receipts"] or 0))
        holder = by_bio.get(r.get("seat_holder"))
        out.append({
            "state": st, "status": status,
            "seat_holder": {k: holder[k] for k in ("bioguide", "name", "party")} if holder else None,
            "winner": r.get("winner") if status in ("called", "certified") else None,
            "called_by": r.get("called_by") if status in ("called", "certified") else None,
            "called_at": r.get("called_at"), "source_url": r.get("source_url"),
            "notes": r.get("notes"), "updated": r.get("updated"),
            "nominees": nominees,
            "filers": [{k: c[k] for k in ("name", "party", "status", "receipts", "cash_on_hand", "through", "source")}
                       for c in filers[:10]],
        })
    with open(D("elections.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "year": races.get("year"), "election_day": races.get("election_day"),
                   "money_through": cands.get("fetched"), "races": out}, f, separators=(",", ":"))
    print(f"Elections: {len(out)} races, {sum(1 for r in out if r['status'] in ('called', 'certified'))} called")


if __name__ == "__main__":
    main()
