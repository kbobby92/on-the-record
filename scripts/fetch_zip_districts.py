"""Build data/zip_districts.json: which congressional district(s) each ZIP code falls in.

Source: the Census Bureau's 119th Congressional District to ZIP Code Tabulation Area relationship file.
A ZIP can cross district lines, so each ZIP lists every district it touches with the share of the ZIP's
land area in each, largest first:  {"85004": [["AZ-3", 71], ["AZ-4", 29]], ...}

District lines are fixed for a Congress, so this only runs when the file is missing (or with --force).
"""
import csv, io, json, os, sys, zipfile

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "zip_districts.json")
URLS = [
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt",
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd119_zcta520_natl.txt",
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.zip",
]
FIPS = {"01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
        "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
        "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
        "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
        "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
        "56": "WY", "72": "PR"}


def download():
    for url in URLS:
        try:
            r = requests.get(url, timeout=120, headers={"User-Agent": "on-the-record open-data project"})
        except requests.RequestException as e:
            print("failed", url, e); continue
        if not r.ok:
            print(r.status_code, url); continue
        data = r.content
        if url.endswith(".zip"):
            z = zipfile.ZipFile(io.BytesIO(data))
            data = z.read(next(n for n in z.namelist() if n.endswith(".txt")))
        print("Downloaded", url)
        return data.decode("utf-8-sig", errors="replace")
    # Fall back to the per-state files and stitch them together.
    base = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_st{fips}.txt"
    parts, header = [], None
    for fips in FIPS:
        try:
            r = requests.get(base.format(fips=fips), timeout=60, headers={"User-Agent": "on-the-record open-data project"})
        except requests.RequestException:
            continue
        if not r.ok:
            continue
        lines = r.content.decode("utf-8-sig", errors="replace").splitlines()
        if lines:
            header = header or lines[0]
            parts += lines[1:]
    if header and parts:
        print(f"Downloaded {len(parts)} rows from the per-state files")
        return "\n".join([header] + parts)
    return None


def main():
    if os.path.exists(OUT) and "--force" not in sys.argv:
        print("zip_districts.json exists; skipping."); return
    text = download()
    if not text:
        print("Couldn't download the ZIP-to-district file; the site will offer a state + district picker instead."); return
    rows = csv.DictReader(io.StringIO(text), delimiter="|")
    cols = rows.fieldnames or []
    cd_col = next(c for c in cols if c.startswith("GEOID_CD119"))
    z_col = next(c for c in cols if c.startswith("GEOID_ZCTA5"))
    land = next((c for c in cols if c.startswith("AREALAND_PART")), None)
    acc = {}
    for r in rows:
        z, cd = (r.get(z_col) or "").strip(), (r.get(cd_col) or "").strip()
        # "ZZ" districts are water or undefined areas; skip them.
        if len(z) != 5 or len(cd) != 4 or cd[:2] not in FIPS or not cd[2:].isdigit():
            continue
        st, dist = FIPS[cd[:2]], int(cd[2:])
        if dist in (98, 99):  # delegates / not defined
            dist = 0
        seat = f"{st}-{'AL' if dist == 0 else dist}"
        acc.setdefault(z, {})
        acc[z][seat] = acc[z].get(seat, 0) + float(r.get(land) or 1)
    out = {}
    for z, seats in acc.items():
        tot = sum(seats.values()) or 1
        ranked = sorted([[s, round(100 * a / tot)] for s, a in seats.items()], key=lambda x: -x[1])
        out[z] = [x for x in ranked if x[1] >= 1] or ranked[:1]
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)
    multi = sum(1 for v in out.values() if len(v) > 1)
    print(f"ZIP to district: {len(out)} ZIPs, {multi} split across districts")


if __name__ == "__main__":
    main()
