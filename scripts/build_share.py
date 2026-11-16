"""Share links and preview cards.

Social sites (X, Facebook, iMessage, Slack...) don't run JavaScript and ignore everything after "#", so the
app's own addresses (#/s/W000437) all show the same generic preview. This script gives every shareable page a
real address with its own title, description and preview image, then forwards people into the app:

  s/<bioguide>/        a senator             -> #/s/<bioguide>
  p/<promise id>/      one promise           -> #/s/<bioguide>/promise/<promise id>
  state/<ST>/          a state's senators    -> #/state/<ST>
  elections/<ST>/      one 2026 race         -> #/elections/<ST>
  issue/<id>/          an issue              -> #/issue/<id>
  senate/ promises/ elections/ issues/ news/ about/

Preview images (1200x630) are drawn with Pillow into assets/og/. Files are only rewritten when their content
changes, so the daily run doesn't churn the repository.
"""
import hashlib, io, json, os, re, shutil, textwrap
from html import escape

import requests
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = lambda *p: os.path.join(ROOT, "data", *p)
SITE = "https://kbobby92.github.io/on-the-record/"
OG = os.path.join(ROOT, "assets", "og")
W, H = 1200, 630
BG, INK, MUTED, FAINT, LINE = (0, 0, 0), (255, 255, 255), (164, 169, 178), (107, 112, 121), (29, 32, 38)
ACCENT = (0, 211, 106)
PARTY = {"D": (79, 148, 255), "R": (255, 92, 98), "I": (181, 140, 255)}
PARTY_NAME = {"D": "Democrat", "R": "Republican", "I": "Independent"}
STATUS = {"kept": ("Kept", ACCENT), "compromise": ("Compromise", (255, 181, 71)), "in_progress": ("In progress", (255, 181, 71)),
          "stalled": ("Stalled", (255, 107, 113)), "broken": ("Broken", (255, 107, 113)), "not_started": ("Not yet reviewed", (107, 112, 121))}
STATES = {"AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado", "CT": "Connecticut",
          "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
          "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
          "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire",
          "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
          "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee",
          "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming"}
FONT_B = os.path.join(ROOT, "assets", "fonts", "Manrope-ExtraBold.ttf")
FONT_M = os.path.join(ROOT, "assets", "fonts", "Manrope-Medium.ttf")
_fonts = {}
def font(size, bold=True):
    k = (size, bold)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype(FONT_B if bold else FONT_M, size)
    return _fonts[k]

def load(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default

written = {"img": 0, "page": 0}
def write_if_changed(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path):
        with open(path, "rb") as f:
            if f.read() == data:
                return False
    with open(path, "wb") as f:
        f.write(data)
    return True

# ---------- drawing helpers ----------
_photos = {}
def photo(bioguide):
    if bioguide in _photos:
        return _photos[bioguide]
    img = None
    for size in ("450x550", "225x275"):
        try:
            r = requests.get(f"https://raw.githubusercontent.com/unitedstates/images/gh-pages/congress/{size}/{bioguide}.jpg", timeout=30)
            if r.ok:
                img = Image.open(io.BytesIO(r.content)).convert("RGB")
                break
        except requests.RequestException:
            pass
    _photos[bioguide] = img
    return img

def circle_photo(canvas, bioguide, party, initials, x, y, d):
    img = photo(bioguide) if bioguide else None
    if img:
        w, h = img.size
        side = min(w, h)
        img = img.crop(((w - side) // 2, 0, (w - side) // 2 + side, side)).resize((d, d), Image.LANCZOS)
    else:
        img = Image.new("RGB", (d, d), (22, 25, 30))
        ImageDraw.Draw(img).text((d / 2, d / 2), initials, font=font(int(d * 0.32)), fill=MUTED, anchor="mm")
    mask = Image.new("L", (d * 4, d * 4), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=255)
    canvas.paste(img, (x, y), mask.resize((d, d), Image.LANCZOS))
    dr = ImageDraw.Draw(canvas)
    r = max(14, d // 9)
    cx, cy = x + d - r * 1.1, y + d - r * 1.1
    dr.ellipse((cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6), fill=BG)
    dr.ellipse((cx - r, cy - r, cx + r, cy + r), fill=PARTY.get(party, FAINT))

def fit(dr, text, size, maxw, bold=True, minsize=26):
    while size > minsize and dr.textlength(text, font=font(size, bold)) > maxw:
        size -= 2
    return size

def wrap(dr, text, size, maxw, lines, bold=True):
    words, out, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if dr.textlength(t, font=font(size, bold)) <= maxw:
            cur = t
        else:
            out.append(cur); cur = w_
    if cur:
        out.append(cur)
    if len(out) > lines:
        out = out[:lines]
        while out[-1] and dr.textlength(out[-1] + "…", font=font(size, bold)) > maxw:
            out[-1] = out[-1].rsplit(" ", 1)[0]
        out[-1] += "…"
    return out

def frame(eyebrow=None):
    im = Image.new("RGB", (W, H), BG)
    dr = ImageDraw.Draw(im)
    dr.rounded_rectangle((60, 52, 104, 96), radius=12, fill=ACCENT)
    dr.text((82, 74), "OR", font=font(18), fill=BG, anchor="mm")
    dr.text((118, 74), "On the Record", font=font(28), fill=INK, anchor="lm")
    if eyebrow:
        dr.text((W - 60, 74), eyebrow, font=font(24, False), fill=MUTED, anchor="rm")
    dr.line((60, H - 82, W - 60, H - 82), fill=LINE, width=2)
    dr.text((60, H - 46), "Public records, every source linked", font=font(22, False), fill=FAINT, anchor="lm")
    dr.text((W - 60, H - 46), "kbobby92.github.io/on-the-record", font=font(22), fill=ACCENT, anchor="rm")
    return im, dr

def save_img(im, name):
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=84, optimize=True, progressive=True)
    data = buf.getvalue()
    if write_if_changed(os.path.join(OG, name), data):
        written["img"] += 1
    return f"{SITE}assets/og/{name}?v={hashlib.sha1(data).hexdigest()[:8]}"

def initials(name):
    parts = [p for p in re.sub(r"[^A-Za-z .'-]", "", name).split() if p[0].isupper() and not p.endswith(".")]
    return (parts[0][0] + parts[-1][0]) if len(parts) > 1 else name[:2]

def pct(v):
    return "—" if v is None else f"{v:g}%"

def ipct(v):  # whole numbers on images, so a card only changes when a number meaningfully moves
    return "—" if v is None else f"{round(v)}%"

# ---------- cards ----------
def senator_card(s, full, house=False):
    m = s["metrics"]; p = s["party"][0]
    im, dr = frame(f"{'Representative' if house else 'Senator'} since {s['serving_since'][:4]}")
    circle_photo(im, s["bioguide"], p, initials(s["name"]), 70, 150, 300)
    x = 430
    where = STATES.get(s["state"], s["state"]) + (f" · {'District ' + str(s['district']) if s['district'] else 'At-large'}" if house else "")
    dr.text((x, 168), f"{PARTY_NAME.get(p, s['party'])} · {where}", font=font(fit(dr, f"{PARTY_NAME.get(p, s['party'])} · {where}", 30, W - x - 70, False, 22), False), fill=MUTED)
    dr.text((x, 206), s["name"], font=font(fit(dr, s["name"], 66, W - x - 70)), fill=INK)
    kept = (m.get("promises_by_status") or {}).get("kept", 0)
    stats = [("Attendance", ipct(m.get("attendance"))), ("Votes with party", ipct(m.get("party_unity")))]
    if m.get("follow_through") is not None:
        stats.append(("Follow-through", ipct(m["follow_through"])))
    elif m.get("promises_tracked"):
        stats.append(("Promises kept", f"{kept} of {m['promises_tracked']}"))
    else:
        stats.append(("Bills sponsored", str(m.get("bills_sponsored") or "—")))
    colw = (W - x - 60) // 3
    for i, (lbl, val) in enumerate(stats):
        cx = x + i * colw
        dr.text((cx, 330), val, font=font(fit(dr, val, 58, colw - 20)), fill=INK)
        dr.text((cx, 404), lbl, font=font(fit(dr, lbl, 24, colw - 16, False, 18), False), fill=MUTED)
    e = s.get("election") or {}
    note = {"reelected": f"Won re-election in {e.get('year')}", "lost": f"Lost the {e.get('year')} election",
            "not_on_ballot": f"Leaving in January · {e.get('winner', '')} won the seat"}.get(e.get("outcome"))
    if note:
        dr.rounded_rectangle((x, 466, x + dr.textlength(note, font=font(24)) + 36, 510), radius=22, fill=(16, 40, 28) if e.get("outcome") == "reelected" else (22, 25, 30))
        dr.text((x + 18, 488), note, font=font(24), fill=ACCENT if e.get("outcome") == "reelected" else MUTED, anchor="lm")
    return im

def promise_card(pr, s):
    p = s["party"][0]
    label, col = STATUS.get(pr.get("status"), ("Not yet reviewed", FAINT))
    im, dr = frame("Promise check")
    circle_photo(im, s["bioguide"], p, initials(s["name"]), 60, 132, 96)
    dr.text((176, 150), s["name"], font=font(34), fill=INK)
    dr.text((176, 192), f"{PARTY_NAME.get(p, '')} · {STATES.get(s['state'], s['state'])} · {pr.get('source_date', '')[:4]}", font=font(24, False), fill=MUTED)
    text = pr.get("promise") or pr.get("quote") or ""
    size = 46
    lines = wrap(dr, text, size, W - 120, 4)
    if len(lines) == 4:
        size = 40; lines = wrap(dr, text, size, W - 120, 4)
    y = 266
    for ln in lines:
        dr.text((60, y), ln, font=font(size), fill=INK); y += int(size * 1.22)
    pw = dr.textlength(label, font=font(30)) + 52
    dr.rounded_rectangle((60, 472, 60 + pw, 526), radius=27, fill=col)
    dr.text((60 + pw / 2, 499), label, font=font(30), fill=BG, anchor="mm")
    n = len(pr.get("evidence") or [])
    if n:
        dr.text((80 + pw, 499), f"Checked against {n} record{'s' if n != 1 else ''}", font=font(24, False), fill=MUTED, anchor="lm")
    return im

def state_card(st, pair):
    im, dr = frame("Side by side")
    title = f"{STATES.get(st, st)}'s senators"
    dr.text((60, 140), title, font=font(fit(dr, title, 60, W - 120)), fill=INK)
    for i, s in enumerate(pair[:2]):
        x = 60 + i * 560
        circle_photo(im, s["bioguide"], s["party"][0], initials(s["name"]), x, 250, 190)
        dr.text((x + 216, 290), s["name"], font=font(fit(dr, s["name"], 36, 320)), fill=INK)
        dr.text((x + 216, 340), PARTY_NAME.get(s["party"][0], s["party"]), font=font(26, False), fill=PARTY.get(s["party"][0], MUTED))
        dr.text((x + 216, 384), f"Attendance {ipct(s['metrics'].get('attendance'))}", font=font(24, False), fill=MUTED)
    return im

def race_card(r):
    im, dr = frame("2026 Senate race")
    st = STATES.get(r["state"], r["state"])
    dr.text((60, 130), st, font=font(64), fill=INK)
    status = {"called": "Called", "certified": "Certified", "counting": "Still counting", "runoff": "Runoff", "recount": "Recount"}.get(r["status"], r["status"])
    sub = f"{status}" + (f" for {r['winner']}" if r.get("winner") else "") + (f" · by {r['called_by']}" if r.get("called_by") else "")
    dr.text((60, 214), sub, font=font(fit(dr, sub, 30, W - 120, False), False), fill=MUTED)
    if r.get("flip"):
        dr.rounded_rectangle((W - 260, 140, W - 60, 190), radius=25, fill=(30, 33, 40))
        dr.text((W - 160, 165), "Seat flips", font=font(26), fill=ACCENT, anchor="mm")
    y = 280
    for n in r["nominees"][:3]:
        party = {"DEM": "D", "DFL": "D", "REP": "R"}.get((n.get("party") or "").upper(), "I")
        col = PARTY[party]
        name = n["name"] + ("  · Winner" if n.get("won") else "")
        dr.text((60, y), name, font=font(32 if n.get("won") else 30, bool(n.get("won"))), fill=INK if n.get("won") else MUTED)
        if n.get("pct") is not None:
            dr.text((W - 60, y), f"{n['pct']:.1f}%", font=font(32), fill=INK, anchor="ra")
            dr.rounded_rectangle((60, y + 46, W - 60, y + 56), radius=5, fill=(22, 25, 30))
            dr.rounded_rectangle((60, y + 46, 60 + int((W - 120) * n["pct"] / 100), y + 56), radius=5, fill=col)
        y += 84
    return im

def text_card(title, sub, eyebrow=None):
    im, dr = frame(eyebrow)
    lines = wrap(dr, title, 72, W - 120, 2)
    y = 180
    for ln in lines:
        dr.text((60, y), ln, font=font(72), fill=INK); y += 86
    for ln in wrap(dr, sub, 34, W - 120, 3, False):
        dr.text((60, y + 20), ln, font=font(34, False), fill=MUTED); y += 46
    return im

# ---------- stub pages ----------
def page(path, route, title, desc, image):
    depth = path.strip("/").count("/") + 1
    rel = "../" * depth
    url = SITE + path
    target = f"{rel}#/{route}"
    t, d = escape(title), escape(desc)
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{t}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="{d}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website"><meta property="og:site_name" content="On the Record">
<meta property="og:title" content="{t}"><meta property="og:description" content="{d}">
<meta property="og:url" content="{url}"><meta property="og:image" content="{image}">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}"><meta name="twitter:image" content="{image}">
<meta name="theme-color" content="#000000">
<script>location.replace({json.dumps(target)});</script>
<meta http-equiv="refresh" content="0; url={escape(target)}">
<style>body{{background:#000;color:#a4a9b2;font:16px system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}}a{{color:#00d36a}}</style>
</head><body><p>Opening <a href="{escape(target)}">{t}</a>…</p></body></html>
"""
    if write_if_changed(os.path.join(ROOT, path, "index.html"), html.encode("utf-8")):
        written["page"] += 1

def main():
    idx = load(D("index.json"), {"senators": []})
    elections = load(D("elections.json"), {"races": []})
    issues = load(D("issues_index.json"), {"issues": []})
    promises = load(D("promises_index.json"), {"promises": []})["promises"]
    dash = load(D("dashboard.json"), {})
    by_bio = {s["bioguide"]: s for s in idx["senators"]}
    keep = set()

    for s in idx["senators"]:
        m = s["metrics"]; p = s["party"][0]
        img = save_img(senator_card(s, None), f"s-{s['bioguide']}.jpg"); keep.add(f"s-{s['bioguide']}.jpg")
        bits = [f"Attendance {pct(m.get('attendance'))}", f"votes with own party {pct(m.get('party_unity'))}"]
        if m.get("promises_tracked"):
            bits.append(f"{(m.get('promises_by_status') or {}).get('kept', 0)} of {m['promises_tracked']} promises kept")
        if m.get("bills_sponsored") is not None:
            bits.append(f"{m['bills_sponsored']} bills sponsored")
        page(f"s/{s['bioguide']}/", f"s/{s['bioguide']}", f"{s['name']} ({p}-{s['state']}) | On the Record",
             ". ".join([", ".join(bits)[0].upper() + ", ".join(bits)[1:], "Votes, promises and campaign money, from public records."]), img)

    hidx = load(D("house_index.json"), {"members": []})
    hdash = load(D("house_dashboard.json"), {})
    for s in hidx["members"]:
        m = s["metrics"]; p = s["party"][0]
        img = save_img(senator_card(s, None, house=True), f"r-{s['bioguide']}.jpg"); keep.add(f"r-{s['bioguide']}.jpg")
        bits = [f"Attendance {pct(m.get('attendance'))}", f"votes with own party {pct(m.get('party_unity'))}"]
        if m.get("bills_sponsored") is not None:
            bits.append(f"{m['bills_sponsored']} bills sponsored")
        page(f"r/{s['bioguide']}/", f"r/{s['bioguide']}", f"{s['name']} ({p}-{s['seat']}) | On the Record",
             ". ".join([", ".join(bits)[0].upper() + ", ".join(bits)[1:], "Votes, bills and campaign money, from public records."]), img)

    for pr in promises:
        s = by_bio.get(pr["bioguide"])
        if not s:
            continue
        img = save_img(promise_card(pr, s), f"p-{pr['id']}.jpg"); keep.add(f"p-{pr['id']}.jpg")
        label = STATUS.get(pr.get("status"), ("Not yet reviewed",))[0]
        page(f"p/{pr['id']}/", f"s/{pr['bioguide']}/promise/{pr['id']}", f"Promise check: {s['name']} ({s['party'][0]}-{s['state']}) | {label}",
             f"{pr.get('promise') or ''} Status: {label}. See the quote, the source and the record since.", img)

    states = {}
    for s in idx["senators"]:
        states.setdefault(s["state"], []).append(s)
    for st, pair in states.items():
        pair.sort(key=lambda s: s.get("class", 0))
        img = save_img(state_card(st, pair), f"state-{st}.jpg"); keep.add(f"state-{st}.jpg")
        page(f"state/{st}/", f"state/{st}", f"{STATES.get(st, st)}'s senators, side by side | On the Record",
             f"{' and '.join(s['name'] for s in pair)}: votes, attendance, promises and campaign money compared.", img)

    for r in elections.get("races", []):
        img = save_img(race_card(r), f"race-{r['state']}.jpg"); keep.add(f"race-{r['state']}.jpg")
        top = r["nominees"][:2]
        line = " vs. ".join(f"{n['name']}" + (f" {n['pct']:.1f}%" if n.get("pct") is not None else "") for n in top)
        page(f"elections/{r['state']}/", f"elections/{r['state']}", f"2026 Senate race in {STATES.get(r['state'], r['state'])} | On the Record",
             f"{line}. " + (f"Called for {r['winner']} by {r['called_by']}." if r.get("winner") else "Not called yet."), img)

    for i in issues.get("issues", []):
        img = save_img(text_card(i["title"], f"{i['votes']} key votes · {i['promises']} promises · {i['statements']} statements · how every senator voted", "Issue"), f"issue-{i['id']}.jpg")
        keep.add(f"issue-{i['id']}.jpg")
        page(f"issue/{i['id']}/", f"issue/{i['id']}", f"{i['title']} | On the Record", i.get("summary", "")[:200], img)

    cj = dash.get("count_jan") or {}
    flips = sum(1 for x in dash.get("january", []) if x.get("flip"))
    generic = [
        ("home", "", "Skip the noise. Check the record.", "Votes, promises and money for every member of Congress, from public records, each linked to its source."),
        ("senate", "senate", "All 100 senators, one place", "Attendance, party-line voting, promises, bills and campaign money for every senator."),
        ("promises", "promises", "Every promise, checked against the record", f"{len(promises)} promises tracked so far, each with the senator's own words and what they did since."),
        ("elections", "elections", "2026 Senate results", (f"Senate in January: {cj.get('D')} Democrats, {cj.get('R')} Republicans. {flips} seats change party." if cj else "Every race, called and counted.")),
        ("house", "house", "All 435 House seats, one place",
         (f"{hdash['counts']['R']} Republicans, {hdash['counts']['D']} Democrats. Find your representative and check their votes, bills and campaign money." if hdash.get("counts") else "Every representative's votes, bills and campaign money.")),
        ("issues", "issues", "The big fights in the Senate", "Key votes, how every senator voted, and what they promised and said."),
        ("news", "news", "Senate news, all in one place", "Headlines about senators from outlets across the spectrum, plus official actions."),
        ("about", "about", "How On the Record works", "Where the data comes from and how every number is calculated."),
    ]
    home_img = None
    for name, route, title, sub in generic:
        img = save_img(text_card(title, sub), f"{name}.jpg"); keep.add(f"{name}.jpg")
        if name == "home":
            home_img = img
        else:
            page(f"{route}/", route, f"{title} | On the Record", sub, img)

    # Home page (index.html): keep its preview tags current.
    ip = os.path.join(ROOT, "index.html")
    html = open(ip, encoding="utf-8").read()
    tags = (f'<!-- og:start -->\n<meta property="og:type" content="website"><meta property="og:site_name" content="On the Record">\n'
            f'<meta property="og:title" content="On the Record"><meta property="og:description" content="Votes, promises and money for every member of Congress, from public records, each linked to its source.">\n'
            f'<meta property="og:url" content="{SITE}"><meta property="og:image" content="{home_img}">\n'
            f'<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">\n'
            f'<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{home_img}">\n<!-- og:end -->')
    new = re.sub(r"<!-- og:start -->.*?<!-- og:end -->", lambda _: tags, html, flags=re.S) if "<!-- og:start -->" in html \
        else html.replace('<link rel="stylesheet"', tags + '\n<link rel="stylesheet"', 1)
    if new != html:
        open(ip, "w", encoding="utf-8").write(new)

    # Remove images and pages for things that no longer exist (e.g. a deleted promise).
    for f in os.listdir(OG):
        if f.endswith(".jpg") and f not in keep:
            os.remove(os.path.join(OG, f))
    for d, valid in (("p", {pr["id"] for pr in promises}), ("s", set(by_bio)), ("r", {m["bioguide"] for m in hidx["members"]}), ("state", set(states)),
                     ("elections", {r["state"] for r in elections.get("races", [])}), ("issue", {i["id"] for i in issues.get("issues", [])})):
        base = os.path.join(ROOT, d)
        if os.path.isdir(base):
            for sub in os.listdir(base):
                if os.path.isdir(os.path.join(base, sub)) and sub not in valid:
                    shutil.rmtree(os.path.join(base, sub))
    print(f"Share cards: {len(keep)} images ({written['img']} changed), {written['page']} pages changed")


if __name__ == "__main__":
    main()
