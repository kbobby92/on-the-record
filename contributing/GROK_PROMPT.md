# Prompts to give Grok

Copy one of these into Grok. Replace the parts in [brackets]. Paste Grok's JSON reply
into a file and run `python scripts/validate_entries.py yourfile.json`.

---

## 1. Collect campaign promises (do this for 2026 winners right away)

> I'm building a nonpartisan, source-linked tracker of U.S. senators' campaign promises.
> For Senator/Senator-elect [NAME] ([STATE]), bioguide ID [BIOGUIDE], find their specific,
> checkable campaign promises from the [2026] campaign: their campaign website, debates,
> interviews and their posts on X.
>
> Rules:
> - Only include promises where you can give the **exact quote** and a **working link** to where it was said. If you can't link it, leave it out. Never paraphrase inside "quote".
> - Prefer specific, measurable promises ("cap insulin at $35") over vague ones. Mark vague ones `"specific": false`.
> - Set every `"status": "not_started"`, `"evidence": []`, `"added_by": "grok"`, `"verified": false`, `"verified_by": null`.
> - Number ids as p-[BIOGUIDE]-001, -002, ...
> - Dates as YYYY-MM-DD.
>
> Reply with only JSON in this shape, no commentary:
> `{"promises": [ {"id": "", "bioguide": "", "senator": "", "promise": "", "quote": "", "source_url": "", "archive_url": "", "source_date": "", "topic": "", "specific": true, "status": "not_started", "evidence": [], "added_by": "grok", "verified": false, "verified_by": null, "notes": ""} ]}`

---

## 2. Collect statements from X

> For Senator [NAME] (@[X_HANDLE], bioguide [BIOGUIDE]), list their posts on X from
> [START DATE] to [END DATE] that take a clear position on legislation, a Senate vote, or
> a policy issue. Skip greetings, condolences and event photos.
>
> Rules:
> - "quote" must be the exact post text. "source_url" must be the direct link to the post.
> - If a post names a bill, put it in "related_bill" (e.g. "S. 123" or "H.R. 45").
> - "added_by": "grok", "verified": false, "verified_by": null. Ids: s-[BIOGUIDE]-001, ...
>
> Reply with only JSON: `{"statements": [ {"id": "", "bioguide": "", "senator": "", "platform": "X", "quote": "", "source_url": "", "archive_url": "", "source_date": "", "topic": "", "related_bill": "", "added_by": "grok", "verified": false, "verified_by": null} ]}`

---

## 3. Update a promise's status

> Here is a campaign promise I'm tracking: [PASTE THE PROMISE JSON].
> Find what Senator [NAME] has personally done about it since [DATE]: votes, bills they
> sponsored or cosponsored, and public statements. Give each as an evidence item with a
> date, a one-sentence factual description, and a link to congress.gov, senate.gov or the
> original post. Then suggest a status (in_progress, kept, compromise, stalled, broken)
> with one sentence of reasoning in "notes". Judge only the senator's own actions.
> Reply with only the updated JSON.

---

## Before anything goes live

Open every `source_url`. Confirm the quote matches word for word and the date is right.
Then set `"verified": true` and `"verified_by": "your name"`. AI tools, including Grok and
Claude, sometimes get quotes or links wrong, and this check is what keeps the site trustworthy.
