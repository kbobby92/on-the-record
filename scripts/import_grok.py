"""Import Grok's research into the promise and statement files, as UNVERIFIED entries.

Usage:
  python scripts/import_grok.py                 # imports every .json file in inbox/
  python scripts/import_grok.py reply.json ...  # imports specific files

What it does:
  - pulls the JSON out of Grok's reply (tolerates code fences or stray text around it)
  - matches each person to a senator by name and state, and fills in their bioguide ID
  - numbers new entries, skips duplicates, drops items missing a quote, link or date
  - adds them to data/promises.json / data/statements.json with "verified": false
  - holds people not yet in the Senate (e.g. senators-elect) in data/incoming.json and
    moves them over automatically once they appear in the roster
  - moves imported inbox files to inbox/processed/
Nothing imported here is shown on the site until a person verifies it.
"""
import glob, json, os, re, shutil, sys, unicodedata
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, *p)
URL = re.compile(r"^https?://[^\s]+\.[^\s]+$")
PLATFORMS = {"x": "X", "floor speech": "floor speech", "press release": "press release",
             "interview": "interview", "debate": "debate", "campaign site": "campaign site",
             "op-ed": "op-ed", "town hall": "town hall", "other": "other"}


TOPICS = ["Economy & taxes", "Health care", "Immigration & border", "Energy & environment",
          "Defense & foreign policy", "Guns", "Abortion & reproductive rights", "Education", "Criminal justice",
          "Government & ethics", "Technology", "Agriculture", "Housing", "Labor", "Veterans", "Trade",
          "Social Security & Medicare", "Other"]
# Grok sometimes invents its own topic labels; map common ones onto the fixed list.
TOPIC_MAP = {"elections": "Government & ethics", "voting": "Government & ethics", "appropriations": "Economy & taxes",
             "budget": "Economy & taxes", "government funding": "Economy & taxes", "small business": "Economy & taxes",
             "energy": "Energy & environment", "environment": "Energy & environment", "climate": "Energy & environment",
             "war powers": "Defense & foreign policy", "ukraine": "Defense & foreign policy", "israel": "Defense & foreign policy",
             "iran": "Defense & foreign policy", "national security": "Defense & foreign policy", "intelligence": "Defense & foreign policy",
             "hemp": "Agriculture", "farm bill": "Agriculture", "flood insurance": "Housing",
             "online privacy": "Technology", "ai": "Technology", "tariffs": "Trade", "medicare": "Social Security & Medicare",
             "medicare fraud": "Social Security & Medicare", "social security": "Social Security & Medicare",
             "judicial nominations": "Criminal justice", "immigration": "Immigration & border", "abortion": "Abortion & reproductive rights"}


def topic(t):
    t = (t or "").strip()
    for x in TOPICS:
        if x.lower() == t.lower():
            return x
    return TOPIC_MAP.get(t.lower(), "Other")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z ]", "", s).strip()


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


def extract_json(text):
    text = re.sub(r"```(?:json)?", "", text)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < 0:
        raise ValueError("no JSON object found")
    data = json.loads(text[start:end + 1])
    if isinstance(data, dict):
        items = data.get("items") or []
        for k in ("promises", "statements"):  # older prompt format
            for x in data.get(k, []):
                x.setdefault("type", k[:-1])
                items.append(x)
        return items
    return data


def resolve(item, roster):
    st = (item.get("state") or "").upper().strip()
    words = norm(item.get("senator")).split()
    if not words:
        return None
    exact = [s for s in roster if (not st or s["state"] == st) and norm(s["name"]) == " ".join(words)]
    if len(exact) == 1:
        return exact[0]
    joined = f" {' '.join(words)} "
    cands = [s for s in roster if (not st or s["state"] == st) and f" {norm(s['last'])} " in joined]
    if len(cands) == 1:
        return cands[0]
    first = words[0]
    for s in cands:
        if any(n and (n.startswith(first) or first.startswith(n))
               for n in (norm(s.get("first")), norm(s.get("nickname") or ""))):
            return s
    return None


def problems(item):
    errs = []
    if item.get("type") not in ("promise", "statement"):
        errs.append("type must be promise or statement")
    if not (item.get("quote") or "").strip():
        errs.append("no quote")
    if not URL.match(item.get("source_url") or ""):
        errs.append("no valid source_url")
    try:
        if date.fromisoformat(item.get("source_date", "")) > date.today():
            errs.append("date in the future")
    except ValueError:
        errs.append("bad source_date")
    if item.get("type") == "promise" and not (item.get("promise") or "").strip():
        errs.append("promise has no summary sentence")
    return errs


def to_entry(item, s, existing):
    kind = item["type"]
    prefix = "p" if kind == "promise" else "s"
    nums = [int(m.group(1)) for e in existing
            if (m := re.match(rf"^{prefix}-{s['bioguide']}-(\d+)$", e.get("id", "")))]
    entry = {
        "id": f"{prefix}-{s['bioguide']}-{(max(nums) + 1 if nums else 1):03d}",
        "bioguide": s["bioguide"],
        "senator": s["name"],
        "quote": item["quote"].strip(),
        "source_url": item["source_url"].strip(),
        "archive_url": item.get("archive_url") or "",
        "source_date": item["source_date"],
        "topic": topic(item.get("topic")),
    }
    if kind == "promise":
        entry |= {"promise": item["promise"].strip(), "specific": bool(item.get("specific")),
                  "status": "not_started", "evidence": []}
    else:
        entry |= {"platform": PLATFORMS.get((item.get("platform") or "other").lower(), "other"),
                  "related_bill": item.get("related_bill") or ""}
    entry |= {"added_by": "grok", "verified": False, "verified_by": None,
              "notes": (f"Words in [brackets] added for context: {item['context_note']}" if item.get("context_note")
                        else f"Grok confidence: {item.get('confidence', 'unstated')}")}
    return entry


def main():
    files = sys.argv[1:] or sorted(glob.glob(D("inbox", "*.json")))
    roster = load(D("data", "senators.json"), {"senators": []})["senators"]
    promises = load(D("data", "promises.json"), {"promises": []})
    statements = load(D("data", "statements.json"), {"statements": []})
    incoming = load(D("data", "incoming.json"),
                    {"_about": "Grok items for people not yet in the Senate roster. Imported automatically once they are.",
                     "items": []})
    seen = {(e.get("bioguide"), norm(e.get("quote"))[:120]) for e in promises["promises"] + statements["statements"]}

    queue = [(x, "data/incoming.json") for x in incoming["items"]]
    for path in files:
        with open(path, encoding="utf-8") as f:
            try:
                queue += [(x, os.path.basename(path)) for x in extract_json(f.read())]
            except (ValueError, json.JSONDecodeError) as e:
                sys.exit(f"{path}: couldn't read Grok's JSON ({e}). Nothing was imported.")

    added = {"promise": 0, "statement": 0}
    still_incoming, rejected, dupes = [], [], 0
    for item, src in queue:
        errs = problems(item)
        if errs:
            rejected.append(f"{src}: {item.get('senator')} - {', '.join(errs)}")
            continue
        s = resolve(item, roster)
        if not s:
            still_incoming.append(item)
            continue
        key = (s["bioguide"], norm(item["quote"])[:120])
        if key in seen:
            dupes += 1
            continue
        seen.add(key)
        target = promises["promises"] if item["type"] == "promise" else statements["statements"]
        target.append(to_entry(item, s, target))
        added[item["type"]] += 1

    save(D("data", "promises.json"), promises)
    save(D("data", "statements.json"), statements)
    incoming["items"] = still_incoming
    save(D("data", "incoming.json"), incoming)
    if not sys.argv[1:]:
        os.makedirs(D("inbox", "processed"), exist_ok=True)
        for path in files:
            shutil.move(path, D("inbox", "processed", os.path.basename(path)))

    print(f"Imported {added['promise']} promises and {added['statement']} statements (unverified). "
          f"{dupes} duplicates skipped. {len(still_incoming)} held for people not yet in the Senate.")
    if rejected:
        print(f"{len(rejected)} items rejected:\n  " + "\n  ".join(rejected))


if __name__ == "__main__":
    main()
