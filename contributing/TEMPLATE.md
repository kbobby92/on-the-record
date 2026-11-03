# Adding promises and statements

Promises live in `data/promises.json`, statements in `data/statements.json`.
Anyone (you, Grok, Claude) can draft entries, but **an entry only appears on the site
after a person opens the source link, confirms the quote is word-for-word, and sets
`"verified": true` with their name in `verified_by`.**

Look up a senator's `bioguide` ID in `data/senators.json` (search their name).

## Promise

```json
{
  "id": "p-K000377-001",
  "bioguide": "K000377",
  "senator": "Mark Kelly",
  "promise": "Cap insulin costs at $35 a month",
  "quote": "Exact words, copied from the source, no paraphrasing",
  "source_url": "https://...",
  "archive_url": "https://web.archive.org/web/.../https://...",
  "source_date": "2026-09-14",
  "topic": "Health care",
  "specific": true,
  "status": "not_started",
  "evidence": [
    {"date": "2027-02-10", "description": "Cosponsored S. 123, which caps insulin at $35", "url": "https://www.congress.gov/bill/..."}
  ],
  "added_by": "grok",
  "verified": false,
  "verified_by": null,
  "notes": ""
}
```

Rules:
- `id`: `p-` + bioguide + a running number. Must be unique.
- `specific`: `true` only if you could clearly tell whether it was kept ("cap insulin at $35"). Vague pledges ("fight for families") get `false` and are never graded.
- `status`: one of `not_started`, `in_progress`, `kept`, `compromise`, `stalled`, `broken`. Anything other than `not_started` needs at least one `evidence` item.
- Judge the senator's **own actions** (votes, sponsoring bills, public pushing), not whether Congress passed it.
- `archive_url`: save the page at https://web.archive.org/save first. Campaign sites disappear after elections.

## Statement

```json
{
  "id": "s-K000377-001",
  "bioguide": "K000377",
  "senator": "Mark Kelly",
  "platform": "X",
  "quote": "Exact words of the post or remarks",
  "source_url": "https://x.com/SenMarkKelly/status/...",
  "archive_url": "",
  "source_date": "2026-11-01",
  "topic": "Border security",
  "related_bill": "S. 123",
  "added_by": "grok",
  "verified": false,
  "verified_by": null
}
```

`platform` is one of: X, floor speech, press release, interview, debate, campaign site, op-ed, town hall, other.

## Checking a batch

Save a batch (for example from Grok) as a file shaped like `{"promises": [...]}` or
`{"statements": [...]}`, then run:

```
python scripts/validate_entries.py path/to/batch.json
```

Fix anything it reports, verify each source by hand, then copy the entries into the main file.
The daily job runs the same check and refuses to publish broken entries.
