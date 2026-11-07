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
    lobbying = load(D("raw", "lobbying.json"), {})
    bills = load(D("raw", "bills.json"), {}).get("members", {})
    sectors = load(D("committee_sectors.json"), {"committees": {}})["committees"]
    # Unverified entries are shown on the site with a "Not yet checked" label and DO count toward
    # the follow-through score (owner's decision, Nov 2026); the site says so next to the score.
    promises = load(D("promises.json"), {"promises": []})["promises"]
    statements = load(D("statements.json"), {"statements": []})["statements"]
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

    election_of = seat_elections(roster)

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
            "promises_resolved": len(resolved),
            "statements": len(said),
        }
        m = money.get(bid)
        if m:
            metrics["raised"] = m.get("receipts")
        b = bills.get(bid)
        if b:
            st = Counter(x["stage"] for x in b["sponsored"])
            metrics["bills_sponsored"] = b["sponsored_total"]
            metrics["bills_cosponsored"] = b["cosponsored_total"]
            metrics["bills_law"] = st["law"]
            metrics["bills_passed"] = st["law"] + st["passed"] + st["vetoed"]

        profile = dict(s, metrics=metrics, votes=recent, trades=tx[:400],
                       paper_reports=[r for r in rows if r.get("paper")],
                       money=m, promises=mine, statements=said[:200], election=election_of.get(bid),
                       lobby_contribs=lobby_summary(lobbying.get("contributions", {}).get(bid), lobbying),
                       bills=bills_summary(b))
        with open(D("senators", f"{bid}.json"), "w", encoding="utf-8") as f:
            json.dump(profile, f, separators=(",", ":"))

        index.append({k: s[k] for k in ("bioguide", "name", "last", "party", "caucus", "state", "class",
                                         "next_election", "term_end", "photo", "serving_since")}
                     | {"committees": [c["name"].replace("Senate Committee on ", "").replace("Senate ", "")
                                       for c in s["committees"]], "metrics": metrics,
                        "election": election_of.get(bid)})

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
    build_promises_index(roster, promises, now)
    build_issues(roster, vote_list, summaries, promises, statements, now, lobbying)
    build_dashboard(roster, index, promises, statements, now)
    print(f"Built {len(index)} senator files; {len(vote_list)} votes, {len(trades['reports'])} trade reports, "
          f"{len(money)} money records, {len(promises)} promises ({sum(1 for p in promises if p.get('verified'))} verified), "
          f"{len(statements)} statements ({sum(1 for x in statements if x.get('verified'))} verified)")


SUFFIXES = {"JR", "SR", "II", "III", "IV", "JR.", "SR."}


def bills_summary(b):
    """What the profile's Bills tab needs: every sponsored bill, recent cosponsorships, and counts."""
    if not b:
        return None
    areas = Counter(x["policy"] for x in b["sponsored"] + b["cosponsored"] if x.get("policy"))
    return {"sponsored": b["sponsored"], "cosponsored": b["cosponsored"][:150],
            "sponsored_total": b["sponsored_total"], "cosponsored_total": b["cosponsored_total"],
            "cosponsored_capped": b.get("capped", False),
            "stages": dict(Counter(x["stage"] for x in b["sponsored"])),
            "areas": areas.most_common(8)}


def build_promises_index(roster, promises, now):
    """One list of every promise across the Senate, for the Promises page."""
    by_bio = {s["bioguide"]: s for s in roster}
    rows = []
    for p in promises:
        s = by_bio.get(p.get("bioguide"))
        if not s:
            continue
        ev = p.get("evidence") or []
        rows.append({"id": p["id"], "bioguide": s["bioguide"], "senator": s["name"], "party": s["party"],
                     "state": s["state"], "photo": s.get("photo"), "promise": p.get("promise"),
                     "quote": p.get("quote"), "source_url": p.get("source_url"), "source_date": p.get("source_date"),
                     "topic": p.get("topic"), "specific": bool(p.get("specific")), "status": p.get("status"),
                     "verified": bool(p.get("verified")), "assessment": p.get("assessment"),
                     "evidence": ev, "updated": max([e.get("date") or "" for e in ev] or [""]) or None})
    rows.sort(key=lambda r: (r["updated"] or r["source_date"] or ""), reverse=True)
    with open(D("promises_index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "promises": rows}, f, separators=(",", ":"))


def fec_name(raw):
    """'OSSOFF, T. JONATHAN' -> 'T. Jonathan Ossoff'; 'COLLINS, MICHAEL A JR' -> 'Michael A Collins Jr.'"""
    if not raw or "," not in raw:
        return (raw or "").title()
    last, rest = [x.strip() for x in raw.split(",", 1)]
    words = rest.replace(",", " ").split()
    suffix = [w for w in words if w.upper().rstrip(".") in {x.rstrip(".") for x in SUFFIXES}]
    words = [w for w in words if w not in suffix and w.upper() not in ("MR", "MR.", "MS", "MS.", "DR", "DR.", "MRS", "MRS.", "SEN", "SEN.", "SENATOR", "HON", "HON.", "REP", "REP.")]

    def cap(w):
        w = w.lower().title()
        if w.startswith("Mc") and len(w) > 2:
            w = "Mc" + w[2].upper() + w[3:]
        return w
    name = " ".join([cap(w) for w in words] + ["-".join(cap(x) for x in last.split("-")).replace(" ", " ")])
    if suffix:
        sfx = suffix[0].upper().rstrip(".")
        name += " " + (sfx if sfx in ("II", "III", "IV") else sfx.title() + ".")
    return name


def last_name(name):
    parts = [p for p in name.replace(",", " ").split() if p.upper().rstrip(".") not in {"JR", "SR", "II", "III", "IV"}]
    return parts[-1].lower() if parts else ""


def name_tokens(name):
    return [t for t in re.sub(r"[^a-z ]", " ", (name or "").lower()).split()
            if t not in ("jr", "sr", "ii", "iii", "iv")]


def match_fec(n, state_cands, used, ambiguous):
    """Find a nominee's FEC record by name. Returns None rather than guess when unsure."""
    ln = last_name(n["name"])
    hits = [x for x in state_cands if x["candidate_id"] not in used and last_name(fec_name(x["name"])) == ln]
    if not hits:
        return None
    if ambiguous or len(hits) > 1:
        # Several people share the last name: require the first name (or initial) to match too,
        # and a unique best match; otherwise show no money rather than someone else's.
        mine = name_tokens(n["name"])[:-1]
        def score(x):
            theirs = name_tokens(fec_name(x["name"]))[:-1]
            return sum(1 for a in mine for b in theirs if a == b or (len(a) == 1 and b.startswith(a)) or (len(b) == 1 and a.startswith(b)))
        scored = sorted(((score(x), x.get("party") == n.get("party"), x.get("receipts") or 0, x) for x in hits),
                        key=lambda t: (t[0], t[1], t[2]), reverse=True)
        if scored[0][0] == 0 or (len(scored) > 1 and scored[0][:2] == scored[1][:2] and ambiguous):
            return None
        return scored[0][3]
    return hits[0]



def seat_elections(roster):
    """For each senator whose seat was on the ballot: did they win, lose, or not run?"""
    races = load(D("races.json"), None)
    if not races:
        return {}
    out = {}
    for st, r in races["races"].items():
        bid = r.get("seat_holder")
        if not bid:
            continue
        me = next((s for s in roster if s["bioguide"] == bid), None)
        if not me:
            continue
        ln = last_name(me["name"])
        on_ballot = any(n.get("bioguide") == bid or (last_name(n.get("name") or "") == ln and n.get("incumbent"))
                        for n in r.get("nominees") or [])
        called = r.get("status") in ("called", "certified") and r.get("winner")
        won = bool(called and last_name(r["winner"]) == ln)
        if not called:
            outcome = "counting" if on_ballot else "not_running_counting"
        elif won:
            outcome = "reelected"
        elif on_ballot:
            outcome = "lost"
        else:
            outcome = "not_on_ballot"
        out[bid] = {"year": races.get("year"), "state": st, "status": r.get("status"), "outcome": outcome,
                    "winner": r.get("winner") if called else None, "called_by": r.get("called_by") if called else None,
                    "source_url": r.get("source_url") if called else None}
    return out


def build_issues(roster, vote_list, summaries, promises, statements, now, lobbying=None):
    """data/issues/<id>.json: key votes with party breakdown, bill summaries, related promises and statements."""
    cfg = load(D("issues.json"), None)
    if not cfg:
        return
    by_bio = {s["bioguide"]: s for s in roster}
    def side(s):
        return {"Democrat": "D", "Republican": "R"}.get(s["party"], "I")
    os.makedirs(D("issues"), exist_ok=True)
    listing = []
    for iss in cfg["issues"]:
        tre = re.compile(iss["vote_title"], re.I) if iss.get("vote_title") else None
        qre = re.compile(iss.get("vote_questions") or ".", re.I)
        votes = []
        for v in vote_list:
            name = v["document"].get("name") or ""
            hit = v["id"] in iss.get("vote_ids", []) or (name in iss.get("vote_bills", []) and qre.search(v["question"])) \
                  or (tre and tre.search(v["title"] or "") and qre.search(v["question"]))
            if not hit:
                continue
            parties = {p: {"Y": 0, "N": 0, "NV": 0} for p in ("D", "R", "I")}
            for bid, pos in v["positions"].items():
                if bid in by_bio:
                    parties[side(by_bio[bid])]["Y" if pos == "Y" else "N" if pos == "N" else "NV"] += 1
            votes.append({"id": v["id"], "date": v["date"], "bill": name, "title": v["title"], "question": v["question"],
                          "result": v["result"], "counts": v["counts"], "source": v["source"], "parties": parties,
                          "positions": {b: p for b, p in v["positions"].items() if b in by_bio}})
        votes.sort(key=lambda v: (v["date"], v["id"]), reverse=True)
        bills = []
        for b in iss.get("bills", []):
            m = re.match(r"^(H\.R\.|S\.|H\.J\.Res\.|S\.J\.Res\.|H\.Res\.|S\.Res\.|H\.Con\.Res\.|S\.Con\.Res\.)\s*(\d+)$", b)
            summ = summaries.get(f"119-{m.group(1)}-{m.group(2)}") if m else None
            bills.append({"name": b, "summary": summ})
        xre = re.compile(iss["text_match"], re.I)
        def related(items, kind):
            out = []
            for x in items:
                text = " ".join(str(x.get(k) or "") for k in ("quote", "promise", "related_bill", "assessment"))
                if xre.search(text) and x.get("bioguide") in by_bio:
                    s_ = by_bio[x["bioguide"]]
                    out.append({"kind": kind, "id": x["id"], "bioguide": x["bioguide"], "name": s_["name"],
                                "party": s_["party"], "state": s_["state"], "quote": x["quote"],
                                "promise": x.get("promise"), "status": x.get("status"), "verified": x.get("verified"),
                                "source_url": x["source_url"], "source_date": x["source_date"], "platform": x.get("platform")})
            return sorted(out, key=lambda x: x["source_date"], reverse=True)
        rp, rs = related(promises, "promise"), related(statements, "statement")
        doc = {k: iss[k] for k in ("id", "title", "summary")} | {"updated": now, "votes": votes, "bills": bills,
                                                                 "promises": rp, "statements": rs[:60],
                                                                 "lobbying": issue_lobbying(iss, lobbying or {})}
        with open(D("issues", f"{iss['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(doc, f, separators=(",", ":"))
        listing.append({k: iss[k] for k in ("id", "title", "summary")} |
                       {"votes": len(votes), "promises": len(rp), "statements": len(rs),
                        "latest": votes[0]["date"] if votes else None})
    with open(D("issues_index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "issues": listing}, f, separators=(",", ":"))
    print("Issues: " + ", ".join(f"{i['id']} ({i['votes']} votes, {i['promises']}p/{i['statements']}s)" for i in listing))


STATE_NAMES = dict(x.split(":") for x in (
    "AL:Alabama AK:Alaska AZ:Arizona AR:Arkansas CA:California CO:Colorado CT:Connecticut DE:Delaware FL:Florida GA:Georgia "
    "HI:Hawaii ID:Idaho IL:Illinois IN:Indiana IA:Iowa KS:Kansas KY:Kentucky LA:Louisiana ME:Maine MD:Maryland MA:Massachusetts "
    "MI:Michigan MN:Minnesota MS:Mississippi MO:Missouri MT:Montana NE:Nebraska NV:Nevada NH:New_Hampshire NJ:New_Jersey "
    "NM:New_Mexico NY:New_York NC:North_Carolina ND:North_Dakota OH:Ohio OK:Oklahoma OR:Oregon PA:Pennsylvania RI:Rhode_Island "
    "SC:South_Carolina SD:South_Dakota TN:Tennessee TX:Texas UT:Utah VT:Vermont VA:Virginia WA:Washington WV:West_Virginia "
    "WI:Wisconsin WY:Wyoming").replace("_", "~").split()) 
STATE_NAMES = {k: v.replace("~", " ") for k, v in STATE_NAMES.items()}


def build_dashboard(roster, index, promises, statements, now):
    """data/dashboard.json: chamber seats now and from January, promise totals, and factual insights."""
    el = load(D("elections.json"), {"races": []})
    P = lambda party: {"Democrat": "D", "Republican": "R", "DEM": "D", "DFL": "D", "REP": "R"}.get(party, "I")
    by_holder = {r["seat_holder"]["bioguide"]: r for r in el["races"] if r.get("seat_holder")}
    idx = {s["bioguide"]: s for s in index}
    now_seats, jan_seats = [], []
    for s in index:
        now_seats.append({"b": s["bioguide"], "n": s["name"], "p": P(s["party"]), "st": s["state"],
                          "c": s["next_election"], "a": s["metrics"].get("attendance")})
        r = by_holder.get(s["bioguide"])
        if not r:
            jan_seats.append({"b": s["bioguide"], "n": s["name"], "p": P(s["party"]), "st": s["state"]})
        elif r["status"] in ("called", "certified") and r.get("winner"):
            w = next((n for n in r["nominees"] if n.get("won")), None)
            stays = bool(w and w.get("bioguide") == s["bioguide"]) or last_name(r["winner"]) == last_name(s["name"])
            jan_seats.append({"b": s["bioguide"] if stays else None, "n": r["winner"], "p": P(w["party"]) if w else "I",
                              "st": s["state"], "new": not stays, "flip": bool(w) and P(w["party"]) != P(s["party"])})
        else:
            jan_seats.append({"b": None, "n": f"{s['state']}: not yet called", "p": "X", "st": s["state"], "uncalled": True})
    cnt = lambda seats: {k: sum(1 for x in seats if x["p"] == k) for k in ("D", "R", "I", "X")}
    cn, cj = cnt(now_seats), cnt(jan_seats)

    # Promises
    specific = [p for p in promises if p.get("specific")]
    status = Counter(p.get("status") for p in promises)
    prom = {"tracked": len(promises), "statements": len(statements), "specific": len(specific),
            "kept": status["kept"], "in_progress": status["in_progress"], "compromise": status["compromise"],
            "broken": status["broken"] + status["stalled"], "not_reviewed": status["not_started"],
            "senators": len({p["bioguide"] for p in promises + statements})}

    # Insights: plain facts computed from the data, never opinions.
    ins = []
    def add(text, href=None):
        ins.append({"text": text, "href": href})
    left_now, left_jan = cn["D"] + cn["I"], cj["D"] + cj["I"]
    if cj["X"] < 100:
        if (cn["R"] > 50) != (cj["R"] > 50) and max(cj["R"], left_jan) > 50:
            add(f"**Senate control changes in January.** Republicans hold {cn['R']} seats now; based on called races, "
                f"Democrats and independents will hold {left_jan}" + (f" ({cj['X']} races not yet called)." if cj["X"] else "."), "#/elections")
        else:
            add(f"From January: **{left_jan} Democrats and independents, {cj['R']} Republicans**"
                + (f", with {cj['X']} races not yet called." if cj["X"] else "."), "#/elections")
    lost = [s for s in index if (s.get("election") or {}).get("outcome") == "lost"]
    if lost:
        add(f"**{len(lost)} incumbent{'s' if len(lost) > 1 else ''} lost re-election:** "
            + ", ".join(f"{x['name']} ({x['state']})" for x in lost) + ".", "#/elections")
    flips = [x for x in jan_seats if x.get("flip")]
    if flips:
        add(f"**{len(flips)} seat{'s' if len(flips) > 1 else ''} change{'' if len(flips) > 1 else 's'} party** in January: "
            + ", ".join(sorted({x['st'] for x in flips})) + ".", "#/elections")
    leaving = [s for s in index if (s.get("election") or {}).get("outcome") in ("lost", "not_on_ballot")]
    if leaving:
        add(f"**{len(leaving)} senators leave in January**, and {sum(1 for x in jan_seats if x.get('new'))} new senators take their seats.", "#/elections")
    races = [(r["state"], sum(n.get("receipts") or 0 for n in r["nominees"])) for r in el["races"] if r["nominees"]]
    if races:
        st_, amt = max(races, key=lambda t: t[1])
        add(f"Most money raised in one race: **{STATE_NAMES.get(st_, st_)}**, ${amt / 1e6:,.0f}M across the nominees (FEC).", f"#/elections/{st_}")
    perfect = [s for s in index if s["metrics"].get("attendance") == 100.0]
    if perfect:
        names = ", ".join(x["name"] for x in perfect[:4]) + (f" and {len(perfect) - 4} more" if len(perfect) > 4 else "")
        add(f"**{len(perfect)} senator{'s' if len(perfect) > 1 else ''} haven't missed a roll-call vote** this Congress: {names}.",
            f"#/s/{perfect[0]['bioguide']}" if len(perfect) == 1 else None)
    uni = [s for s in index if s["metrics"].get("party_unity") is not None]
    if uni:
        lo = min(uni, key=lambda s: s["metrics"]["party_unity"])
        add(f"**{lo['name']}** votes with their party least often: {lo['metrics']['party_unity']}% of the time.", f"#/s/{lo['bioguide']}")
    resolved = prom["kept"] + prom["compromise"] + prom["broken"]
    if resolved:
        if prom["kept"] == resolved:
            add(f"**All {resolved} promises resolved so far were kept**; {prom['in_progress']} more are in progress.")
        else:
            add(f"Of **{resolved} resolved promises**, {prom['kept']} were kept"
                + (f" and {prom['broken']} broken or stalled." if prom["broken"] else ".")
                + f" {prom['in_progress']} more are in progress.")

    with open(D("dashboard.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "now": now_seats, "january": jan_seats, "count_now": cn, "count_jan": cj,
                   "promises": prom, "insights": ins}, f, separators=(",", ":"))
    print(f"Dashboard: now {cn}, January {cj}, {len(ins)} insights")


def lobby_summary(items, lobbying):
    """Lobbyist-reported contributions (LD-203) to or honoring one senator."""
    if items is None:
        return None
    def amt(x):
        try:
            return float(x.get("amount") or 0)
        except ValueError:
            return 0.0
    by_firm = defaultdict(float)
    for i in items:
        by_firm[i.get("registrant") or "Unknown"] += amt(i)
    return {"years": lobbying.get("years"), "fetched": lobbying.get("fetched"), "count": len(items),
            "total": round(sum(amt(i) for i in items), 2),
            "top_firms": [{"name": k, "total": round(v, 2)} for k, v in sorted(by_firm.items(), key=lambda kv: -kv[1])[:8]],
            "items": items[:40]}


def issue_lobbying(iss, lobbying):
    """Who filed lobbying reports mentioning this issue's bills."""
    bills = lobbying.get("bills")
    if not bills:
        return None
    names = list(dict.fromkeys(iss.get("bills", []) + iss.get("vote_bills", [])))
    reports = {}
    for b in names:
        for r in bills.get(b, []):
            reports.setdefault(r["uuid"], dict(r, bills=[]))["bills"].append(b)
    clients = {}
    for r in reports.values():
        c = clients.setdefault(r["client"] or "Unknown", {"client": r["client"] or "Unknown", "reports": 0, "amount": 0.0,
                                                          "firms": set(), "bills": set(), "latest": ""})
        c["reports"] += 1
        c["amount"] += r["amount"] or 0
        if r.get("registrant") and r["registrant"] != r["client"]:
            c["firms"].add(r["registrant"])
        c["bills"].update(r["bills"])
        c["latest"] = max(c["latest"], r.get("posted") or "")
    top = sorted(clients.values(), key=lambda c: (-c["amount"], -c["reports"]))
    return {"years": lobbying.get("years"), "fetched": lobbying.get("fetched"), "bills": names,
            "reports": len(reports), "clients": len(clients),
            "by_bill": {b: len(bills.get(b, [])) for b in names},
            "top": [dict(c, firms=sorted(c["firms"])[:3], bills=sorted(c["bills"]), amount=round(c["amount"], 2)) for c in top[:15]]}

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
        state_cands = [c for c in cands["candidates"] if c["state"] == st]
        used = {n.get("candidate_id") for n in r.get("nominees") or [] if n.get("candidate_id")}
        same_last = Counter(last_name(n.get("name") or "") for n in r.get("nominees") or [])
        for n in r.get("nominees") or []:
            c = by_id.get(n.get("candidate_id") or "")
            if not c and n.get("name"):
                c = match_fec(n, state_cands, used, ambiguous=same_last[last_name(n["name"])] > 1)
                if c:
                    used.add(c["candidate_id"])
            nominees.append({"name": n.get("name") or fec_name((c or {}).get("name")), "party": n.get("party") or (c or {}).get("party"),
                             "incumbent": bool(n.get("incumbent")), "bioguide": n.get("bioguide"),
                             "receipts": (c or {}).get("receipts"), "cash_on_hand": (c or {}).get("cash_on_hand"),
                             "through": (c or {}).get("through"), "fec": (c or {}).get("source"),
                             "outside": (c or {}).get("outside")})
        nominees.sort(key=lambda n: -(n["receipts"] or 0))
        if status in ("called", "certified") and r.get("winner"):
            for n in nominees:
                n["won"] = last_name(n["name"] or "") == last_name(r["winner"])
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
            "filers": [{k: c[k] for k in ("party", "status", "receipts", "cash_on_hand", "through", "source")}
                       | {"name": fec_name(c["name"])} for c in filers[:10]],
        })
    # Senate balance: seats not up this year + races called, by party.
    def side(party):
        p = (party or "").upper()
        return "D" if p in ("DEM", "DFL", "DEMOCRAT") else "R" if p in ("REP", "REPUBLICAN") else "I"
    up_states = set(races["races"])
    up_holders = {r.get("seat_holder") for r in races["races"].values()}
    not_up = {"D": 0, "R": 0, "I": 0}
    for s_ in roster:
        if s_["bioguide"] in up_holders:
            continue
        not_up[side({"Democrat": "DEM", "Republican": "REP"}.get(s_["party"], "IND"))] += 1
    called = {"D": 0, "R": 0, "I": 0}
    for r in out:
        if r["status"] in ("called", "certified"):
            w = next((n for n in r["nominees"] if n.get("won")), None)
            called[side(w["party"]) if w else "I"] += 1
    caucus_d = sum(1 for s_ in roster if s_["bioguide"] not in up_holders and s_["party"] == "Independent"
                   and (s_.get("caucus") or "Democrat") == "Democrat")
    balance = {"not_up": not_up, "called": called, "independents_caucus_with_d": caucus_d,
               "uncalled": sum(1 for r in out if r["status"] not in ("called", "certified")),
               "total": sum(not_up.values()) + len(out)}

    with open(D("elections.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": now, "year": races.get("year"), "balance": balance, "election_day": races.get("election_day"),
                   "money_through": cands.get("fetched"), "races": out}, f, separators=(",", ":"))
    print(f"Elections: {len(out)} races, {sum(1 for r in out if r['status'] in ('called', 'certified'))} called")


if __name__ == "__main__":
    main()
