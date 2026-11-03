"""Check data/promises.json and data/statements.json before they reach the site.
Fails (exit code 1) on any problem, so a bad entry can't be published by accident.

Usage: python scripts/validate_entries.py [extra_file.json ...]
       Extra files (e.g. a fresh batch from Grok) are checked with the same rules.
"""
import json, os, re, sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
URL = re.compile(r"^https?://[^\s]+\.[^\s]+$")
STATUSES = {"not_started", "in_progress", "kept", "compromise", "stalled", "broken"}
PLATFORMS = {"x", "floor speech", "press release", "interview", "debate", "campaign site",
             "op-ed", "town hall", "other"}
ADDED_BY = {"grok", "claude", "human"}


def is_date(s):
    try:
        return date.fromisoformat(s) <= date.today()
    except (TypeError, ValueError):
        return False


def check(kind, items, senators, seen):
    errs = []
    for i, e in enumerate(items):
        where = f"{kind}[{i}] ({e.get('id', 'no id')})"
        need = ["id", "bioguide", "quote", "source_url", "source_date", "topic", "added_by", "verified"]
        if kind == "promises":
            need += ["promise", "status", "specific"]
        else:
            need += ["platform"]
        for k in need:
            if k not in e or e[k] in ("", None):
                errs.append(f"{where}: missing {k}")
        if e.get("id") in seen:
            errs.append(f"{where}: duplicate id")
        seen.add(e.get("id"))
        if e.get("bioguide") and e["bioguide"] not in senators:
            errs.append(f"{where}: unknown bioguide {e['bioguide']}")
        for k in ("source_url", "archive_url"):
            if e.get(k) and not URL.match(e[k]):
                errs.append(f"{where}: {k} is not a URL")
        if e.get("source_date") and not is_date(e["source_date"]):
            errs.append(f"{where}: source_date must be YYYY-MM-DD and not in the future")
        if e.get("added_by") and e["added_by"] not in ADDED_BY:
            errs.append(f"{where}: added_by must be one of {sorted(ADDED_BY)}")
        if not isinstance(e.get("verified"), bool):
            errs.append(f"{where}: verified must be true or false")
        if e.get("verified") and not e.get("verified_by"):
            errs.append(f"{where}: verified entries need verified_by (who checked the source)")
        if kind == "promises":
            if e.get("status") and e["status"] not in STATUSES:
                errs.append(f"{where}: status must be one of {sorted(STATUSES)}")
            if e.get("specific") is False and e.get("status") not in (None, "not_started"):
                errs.append(f"{where}: vague promises (specific=false) are not graded")
            for j, ev in enumerate(e.get("evidence", [])):
                if not (ev.get("url") and URL.match(ev["url"]) and is_date(ev.get("date")) and ev.get("description")):
                    errs.append(f"{where}: evidence[{j}] needs date, description and url")
            if e.get("status") in ("kept", "compromise", "broken", "stalled", "in_progress") and not e.get("evidence"):
                errs.append(f"{where}: status '{e['status']}' needs at least one evidence item")
        else:
            if e.get("platform") and e["platform"].lower() not in PLATFORMS:
                errs.append(f"{where}: platform must be one of {sorted(PLATFORMS)}")
    return errs


def main():
    with open(os.path.join(ROOT, "data", "senators.json"), encoding="utf-8") as f:
        senators = {s["bioguide"] for s in json.load(f)["senators"]}
    files = [os.path.join(ROOT, "data", "promises.json"), os.path.join(ROOT, "data", "statements.json")]
    files += sys.argv[1:]
    errs, seen, n = [], set(), 0
    for path in files:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        for kind in ("promises", "statements"):
            if kind in data:
                errs += [f"{os.path.basename(path)}: {x}" for x in check(kind, data[kind], senators, seen)]
                n += len(data[kind])
    if errs:
        print("\n".join(errs))
        sys.exit(f"{len(errs)} problem(s) found")
    print(f"All {n} entries look valid")


if __name__ == "__main__":
    main()
