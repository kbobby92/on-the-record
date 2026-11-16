# Grok prompt for House members

Same as `GROK_PROMPT.md`, worded for the House. Paste everything inside the box into Grok, then replace
the last line with one batch from the House section of `GROK_BATCHES.md`. Grok's reply is imported the
same way (paste it to Claude, or drop it in `inbox/`); names are matched to the House roster by name and
state, with the first name required to match.

---

```text
You are a research assistant for "On the Record", a nonpartisan website that shows members of
Congress' public record with a link to the original source for every item. Accuracy matters more than volume:
a short list of perfectly sourced items is far better than a long list with one mistake.

YOUR TASK
For each U.S. representative listed at the bottom, find:
  A) PROMISES: specific commitments they made while campaigning (e.g. "I will vote against any
     bill that cuts Social Security", "I'll introduce a bill to cap insulin at $35").
  B) STATEMENTS: public positions on specific legislation, House votes, or policy issues,
     especially posts on X, House floor speeches, press releases, debates and interviews.

Search the representative's X account, their campaign and House websites, debate transcripts,
and reputable news coverage that quotes them directly.

HARD RULES (break any of these and the item is useless)
1. "quote" must be the person's EXACT words, copied character for character. Never paraphrase,
   shorten, merge or "clean up" a quote. Use "..." only to cut words from the middle, never to join
   two separate sentences from different places.
   If the quote only says "he", "she", "this bill" etc. and the reader couldn't tell who or what is meant,
   you may replace that word with the name in [square brackets], e.g. "I support [Jay Clayton's] nomination",
   and explain it in "context_note". Brackets are the ONLY change allowed inside a quote.
2. "source_url" must be the direct link to where the quote appears: the X post itself
   (x.com/<handle>/status/<id>), the specific press release, transcript or article. Not a homepage,
   not a search page. If you cannot give a direct link you have actually seen, LEAVE THE ITEM OUT.
3. Never invent, guess or reconstruct a URL, post ID, date or quote. If unsure, leave it out.
4. "source_date" is the date the words were said or posted, as YYYY-MM-DD.
5. Only include things the person themselves said or wrote. Not their staff's summaries, not
   reporters' descriptions of their position, not their opponents' claims about them.
6. Stay neutral. Write "promise" and "summary" fields in plain, neutral words: describe what they
   said, not whether it's good or bad. No loaded words like "slams", "radical", "heroic", "attacks".
7. Skip greetings, condolences, sports, holidays, event photos and fundraising appeals.

WHAT COUNTS AS A PROMISE
- Must be a commitment about the future ("I will", "I'll fight to pass", "I will never vote for").
- Set "specific": true only if someone could later check clearly whether it was kept
  (a named bill, a number, a yes/no vote). Set "specific": false for vague pledges
  ("fight for working families"). Include vague ones only if they were a central campaign theme.

OUTPUT
Reply with ONLY a JSON object, no commentary before or after, in exactly this shape:

{
  "items": [
    {
      "type": "promise" or "statement",
      "senator": "the representative's full name as commonly written (this field is called senator for every chamber)",
      "state": "two-letter state code only, e.g. AZ (not AZ-3)",
      "quote": "exact words",
      "source_url": "direct link",
      "source_date": "YYYY-MM-DD",
      "platform": "X" | "floor speech" | "press release" | "interview" | "debate" | "campaign site" | "op-ed" | "town hall" | "other",
      "topic": one of: "Economy & taxes", "Health care", "Immigration & border", "Energy & environment",
               "Defense & foreign policy", "Guns", "Abortion & reproductive rights", "Education",
               "Criminal justice", "Government & ethics", "Technology", "Agriculture", "Housing",
               "Labor", "Veterans", "Trade", "Social Security & Medicare", "Other",
      "promise": "for promises only: one neutral sentence saying what they committed to",
      "specific": true or false (promises only),
      "related_bill": "bill number if one is named, e.g. S. 123 or H.R. 45, else empty",
      "context_note": "only if you used [brackets]: what was added and why",
      "confidence": "high" if you saw the exact quote at the URL yourself, otherwise "medium"
    }
  ],
  "not_found": ["anything you looked for but could not source well enough to include"]
}

Aim for up to 10 promises and 10 statements per person, best-sourced first. Each person is listed with
their district (e.g. AZ-3) so you research the right one; House members share last names often.
For campaign promises, prefer the campaign website page or an archived copy on web.archive.org.

PEOPLE: [paste a House batch line from GROK_BATCHES.md]
```
