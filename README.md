# On the Record

A nonpartisan site that puts each member of Congress's public record (starting with the Senate) in one place: votes,
stock trades, campaign money, committee seats, campaign promises and public statements.
Every item links to its original government or primary source.

It runs entirely on GitHub for free: GitHub Pages serves the site, and a scheduled
GitHub Action refreshes the data every day.

## Setup (about 15 minutes)

1. **Create the repo.** On github.com, click **New repository**, name it (this one is `on-the-record`),
   make it **Public**, and create it. Upload everything in this folder (drag the files onto
   the repo page, or use `git push`). Keep the folder structure, including `.github/`.
2. **Turn on GitHub Pages.** Repo → **Settings → Pages** → Source: *Deploy from a branch* →
   Branch: `main`, folder `/ (root)` → Save. Your site will be at
   `https://<your-username>.github.io/on-the-record/`.
3. **Add free API keys** (Repo → **Settings → Secrets and variables → Actions → New repository secret**):
   | Secret name | What it unlocks | Where to get it |
   |---|---|---|
   | `FEC_API_KEY` | Campaign money for all 100 senators | https://api.data.gov/signup |
   | `CONGRESS_API_KEY` | Plain-English bill summaries | https://api.congress.gov/sign-up |
   | `SEC_USER_AGENT` | Industry flags on stock trades | No signup. Set it to something like `On the Record yourname@example.com` (the SEC requires a contact) |

   The site works without them; those sections stay empty until the keys are added.
4. **Run the first update.** Repo → **Actions** tab → enable workflows if asked →
   **Update data** → **Run workflow**. The first run takes a while (it downloads every vote
   and trade report since 2023). After that it runs daily on its own.

## Updating promises and statements

See `contributing/TEMPLATE.md` for the format and `contributing/GROK_PROMPT.md` for
ready-made prompts to have Grok collect them. Nothing shows on the site until a person
has checked the source and set `"verified": true`.

## Project layout

```
index.html, assets/          the website (plain HTML/CSS/JS, no build step)
data/senators.json           roster and committees
data/senators/<id>.json      one file per senator (generated)
data/index.json              overview list (generated)
data/raw/                    downloaded votes, trades, money (generated)
data/promises.json           hand-curated promises
data/statements.json         hand-curated statements
data/committee_sectors.json  which industries each committee oversees
scripts/                     data collection and build scripts
.github/workflows/           the daily update job
```

## Running it on your own computer

```
pip install -r requirements.txt
python scripts/fetch_roster.py
python scripts/fetch_votes.py      # optional, slow the first time
python scripts/fetch_trades.py     # optional
python scripts/fetch_money.py      # optional, set FEC_API_KEY first
python scripts/build_site_data.py
python -m http.server 8000         # then open http://localhost:8000
```

## Notes and known limits

- Stock trade amounts are the ranges the law requires (e.g. "$1,001 - $15,000"), not exact values.
- Reports filed on paper are scanned images and are linked but not itemized.
- The "late" flag uses the STOCK Act's 45-day outer limit, counted from the trade date to the
  date the Senate received the report.
- Committee-overlap flags show where a conflict of interest is *possible*, not that one occurred.
- The data-collection scripts read official government websites. If a site changes its
  layout, a script can break; the daily job keeps the last good data and reports the error
  in the Actions tab.
