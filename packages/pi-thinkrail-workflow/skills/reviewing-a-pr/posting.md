# posting.md — the review on the forge, on confirmation only

Entry: `decisions.md`, `findings.md`, `pr.md`. Saves `review-draft.md` and `review-payload.json`.
This doc ends the workflow in one of the terminal states at the bottom.

## 1. Read the PR again

```
gh pr view <url> --json state,isDraft,headRefOid,mergedAt,reviewDecision
```

- **The head moved** since intake: say so. Findings may be outdated. Offer to check the new
  commits against the findings before posting; do not post against a head that was not reviewed.
- **Merged or closed:** a request for changes is no longer possible. Offer: a comment review on
  the PR, one tracking issue (using the repository's issue template and its labels), both, or
  nothing.

## 2. Draft

Write `review-draft.md`:

**Body.**
- The recommendation in two sentences.
- Requested before merge, then should fix, each as a short list. Decisions the user took appear
  as requests in the user's words, not as the agent's opinion.
- Questions for the author (for example, removals to confirm).
- Minor items, one line each.
- What was checked and what was not, in three lines.
- One line saying the review was prepared with an agent and what "seen in the product" means.

**Inline comments**, one per defect the user chose:
- a title with its label;
- numbered steps, then expected against actual;
- the cause, with `path:line`;
- how it was seen;
- a fix in one or two lines;
- for a reproduced defect, the test in a collapsed block when it is 60 lines or fewer.

Write for the author: factual, specific, no blame. One defect per comment; instances of one
class go in one comment that lists them.

## 3. Validate the anchors

A comment's line must lie inside the PR's diff on the new side.

- Compute the new-side ranges from `git diff -U3 <merge-base> HEAD -- <path>`.
- If the line is outside every hunk, move the comment to the nearest in-diff line that belongs
  to the defect; if there is none, put the comment in the body.

## 4. Confirm

Show the draft with `visualize` (type `file`) and ask one question with `ask_user_question`:

- post as a request for changes, or as a comment (recommend the kind derived from the
  decisions);
- approve — offered only when nothing is labelled fix before merge, and only as the user's own
  explicit choice;
- do not post.

The user may edit the draft first; post what the file contains at confirmation time.

## 5. Post

One call, so the review arrives whole:

```
gh api --method POST repos/<owner>/<repo>/pulls/<n>/reviews --input review-payload.json
```

with `<owner>/<repo>` from the PR's URL recorded at intake (never the checkout's default), `commit_id`
(the reviewed head), `event` (`REQUEST_CHANGES`, `COMMENT` or `APPROVE`),
`body`, and `comments` as `{path, line, side: "RIGHT", body}`.

- Read the response and give the user the review's link.
- On a rejected anchor, fix that comment (or move it to the body) and retry once.

## Never

- Post, approve or request changes without the user's confirmation of that content.
- Post piecemeal, edit the PR's title or body, push to its branch, or resolve others' threads.
- Count an agent's judgment as a person's approval.

## Terminal states

- **Posted:** the link is reported, and `review-draft.md` stays as the record.
- **Declined:** nothing is posted; the brief, findings and draft stay in the Artifacts tab.
- **PR gone or unreachable:** reported as observed; nothing is posted.

In every state, finish with one message naming the brief, the findings and the draft by path.
