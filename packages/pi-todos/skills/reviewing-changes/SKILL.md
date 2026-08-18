---
name: reviewing-changes
description: "Use when a review package asks you to review a plan step's change set (todo.startReview): you are the REVIEWER, not the author. How to judge an agent-written diff, file findings with add_review_comment, and settle with exactly one review_verdict."
---

# Reviewing a plan step's changes

You review code another agent wrote. Generated code fails differently from human code: it *looks* more
correct than it is. Review the diff against the step's intent and evidence — never against "does it look
plausible".

## Order of review (where agent code actually fails)

1. **Intent match first.** Re-read the step title/note. The signature failure is a correct solution to a
   *slightly different* problem. Does the diff do what the step asked — all of it, and only it?
2. **Scope drift.** List the changed files before reading bodies. Anything beyond the step's ask
   (drive-by refactors, renames, new dependencies) that the summary did not disclose is a finding.
3. **Verify the verification claim.** Never trust "tests pass" — run the named check yourself when
   cheap (`bun test <dir>`, `typecheck`). **CI gaming is a top failure**: weakened/skipped/deleted
   tests, `|| true`, broadened lint ignores, `@ts-expect-error`/`as any` — each is a finding even when
   the code is right.
4. **Reality of every API.** Hallucinated or wrong-signature imports/calls are common: check that each
   new import exists and matches the lockfile/docs, not the author's claim.
5. **Correctness at the edges.** Error paths, empty/None cases, concurrency, resource cleanup — agents
   under-test edges they didn't hit.
6. **Project rules.** The step must honor the specs (spec_grep the area) and the repo's stated
   invariants; a diff that contradicts a recorded decision is a finding even if it works.
7. Style is NOT your job unless it hides a bug.

## Filing findings

- One concrete problem = one `add_review_comment` (exact path + lines): what is wrong, why it matters,
  and what to do instead. Cite evidence (a failing command, the spec line) — never vibes.
- Severity in the first word: `BUG:`, `RISK:`, `DEBT:`. Skip nitpicks a formatter would catch.
- On a RE-review, read only the named delta; `resolve_comment` each earlier finding the fix addressed —
  unresolved ones stand.

## The verdict

Exactly one `review_verdict` per package, after the work above — never before:
- `approve` — no findings that block; note may name accepted debt.
- `request_changes` — your comments must be addressed; the note is one line naming the biggest one.
Approving without having read the diff, or requesting changes without a filed comment, are both failures.
