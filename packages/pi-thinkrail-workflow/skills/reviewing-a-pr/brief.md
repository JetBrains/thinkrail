# brief.md — one page, then the decisions

Entry: `findings.md`, `assessment.md`, `evidence.md`, `map.md`, `hunt.md`. Saves `brief.html` and
`decisions.md`. Control goes next to `posting.md`.

## The page

Build `brief.html` from `brief-template.html`, which sits beside this file. It is a static page:
no scripts, at most two embedded images, `<details>` for what is collapsed. The visible text stays
under about 1,500 words; that is a 10 to 15 minute read with the decisions.

Sections, in this order. The order is the point: the reader can stop after any section.

1. **Recommendation.** One of: request changes; approve with follow-ups; nothing found that
   blocks. Two or three sentences, then what it rests on (what was run) and what it does not
   cover. The third wording is not an approval, and the page never says "approve" without the
   list of what was not examined.
2. **What the PR is.** Four bullets at most. A reader who has not opened the PR needs twenty
   seconds of orientation before the decisions make sense.
3. **Your decisions.** Three to six cards. See below.
4. **Defects.** Grouped by what to do: fix before merge, should fix, minor (collapsed). Each row
   is what a user sees, in one or two sentences, with its `browser`, `test` or `read` label.
   Group instances of one class into one row.
5. **Tests and how far to trust this.** The table of deliberate breaks caught per area, with the
   weakest row in bold; what changed in the tests; slices the hunt found clean; what the
   challenge step threw out.
6. **Cost of ownership.** A table of measured numbers and two sentences on what got simpler and
   what got harder.
7. **Not examined.**

Left out on purpose: lists of every description claim or spec sentence the code contradicts.
They did not change a reader's decision. An unmet claim or a broken rule that matters appears as
a decision card or a defect; the rest stays in `map.md` and `assessment.md`.

## What makes a decision card

A card is a judgment call that only the person can make. Typical cards:

- a design trade-off the PR made, with the alternative and what was measured about it;
- the user's blocking policy applied to this PR (for example, tests required before merge);
- a rule the PR introduces that nothing enforces, with the cheapest guard;
- behavior removed without mention: confirm with the author, restore, or leave;
- a risk the author flagged, with what was checked and what remains.

Each card has: the decision in a few words; what is known, in two or three sentences with the
number or observation that matters; **a recommended answer**; the alternative. Use a screenshot
pair only where seeing is faster than reading.

A defect is not a card. "Fix this" needs no decision.

## Rules for the text

- Every number traces to `evidence.md`, `assessment.md` or a test run. No estimates presented
  as counts.
- Labels are honest: `browser` only for what was driven in the product.
- Plain words for a reader who has not seen the code: what a user sees, not which function
  misbehaves. File and line stay in `findings.md`.
- No praise and no hedging. If something is fine, say it once in the recommendation.

## Show it, then ask

1. Show the page with `visualize` (type `file`).
2. In the same turn, one short message: the recommendation, the three facts that carry it, what
   was not run.
3. Ask the decisions with `ask_user_question`, in one round, composed per the
   **asking-user-questions** concept skill:
   - one question per card, the recommended answer first with its reason;
   - one question on which defects go into the review as inline comments (the two top groups
     inline and the minor ones in a summary, as the recommended default).
4. Record the answers in `decisions.md`. Where the user overrules a recommendation, the review
   follows the user.

Derive the kind of review from the answers: any "before merge" answer or any defect labelled fix
before merge means a request for changes; otherwise a comment. The kind is confirmed in
`posting.md`, never assumed.

## If the user does not answer

A skipped round is not a blocker: record the recommended answers as unconfirmed in
`decisions.md` and continue to `posting.md`, which posts nothing without confirmation.

## Next

Read and follow `posting.md`.
