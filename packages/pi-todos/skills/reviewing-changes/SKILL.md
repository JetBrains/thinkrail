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
   (drive-by refactors, renames, new dependencies) that the summary did not disclose is a finding. Also
   scan every changed file for content that doesn't belong at all — a pasted URL/token/credential,
   leftover debug logging, commented-out code — it hides easily inside a file that's legitimately in
   scope, since nothing about the file itself looks wrong.
3. **Verify the verification claim.** Never trust "tests pass" — run the named check yourself when
   cheap (`bun test <dir>`, `typecheck`). **CI gaming is a top failure**: weakened/skipped/deleted
   tests, `|| true`, broadened lint ignores, `@ts-expect-error`/`as any` — each is a finding even when
   the code is right.
4. **Reality of every API.** Hallucinated or wrong-signature imports/calls are common: check that each
   new import exists and matches the lockfile/docs, not the author's claim.
5. **Correctness at the edges.** Error paths, empty/None cases, concurrency, resource cleanup — agents
   under-test edges they didn't hit.
6. **Hunt what is MISSING, not just what is wrong.** The worst bugs in agent code are omissions — no
   added line is wrong, a needed line is absent, so reading the diff top-to-bottom finds nothing. For
   every piece of state the change introduces or touches (in-memory map/latch/registration/mark, temp
   resource, persisted flag), trace its full lifecycle in the resulting code: where it is set → where
   it is cleared → what clears it on EVERY exit path (success, error, abort, a later unrelated turn).
   A set without a clear on some path is a finding. For every fire-and-forget or detached call, name
   what rolls back when it rejects. Then check the OTHER side: for every READER of that same state, ask
   what it does when the state is absent or stale. A permissive default at the read site (an optional
   spread, `?? fallback`, silently continuing instead of rejecting) is a finding exactly like a missing
   clear — a clean producer-side lifecycle still lets a consumer misbehave on the gap.
7. **Invariant audit.** Collect the explicit guarantees in the owning module's SPEC.md (and its
   parent) that touch the changed seams, then check each changed code path against each guarantee —
   mechanically, path × guarantee (spec_grep the area). A diff that contradicts a recorded decision
   or silently drops a stated guarantee is a finding even if it works. The reverse gap is a finding
   too: a diff that establishes or changes an invariant without updating the owning SPEC.md to state
   it — the next review reads a spec that no longer describes reality.
8. **Parallel surfaces and external defaults.** When two paths produce the same artifact (primary +
   fallback, manual + automated, UI + wire), diff their inputs — one deriving from state the other
   ignores is a finding. For every external command/API call, name the defaults the code silently
   relies on (target branch, cwd, locale, config lookup) and verify each is the intended one. When a
   config documents a state ("unset ⇒ default"), verify the UI/wire can actually reach it — a
   documented state with no transition into it is a finding.
9. Style is NOT your job unless it hides a bug.

## Filing findings

- One concrete problem = one `add_review_comment` (exact path + lines): what is wrong, why it matters,
  and what to do instead. Cite evidence (a failing command, the spec line) — never vibes.
- Every finding states a concrete **failure scenario** — the sequence of events in which a user or the
  system actually hits the bug. A problem you can't put a scenario to isn't a finding yet (this also
  kills nitpicks).
- Severity in the first word: `BUG:`, `RISK:`, `DEBT:`. Skip nitpicks a formatter would catch.
- On a RE-review, start from the named delta but widen from there: when the fix touches shared state
  (a map/latch/registration/lifecycle rule), check every OTHER reader/writer of that state too, not
  just the line the original finding cited — a fix that patches only the named call site while a
  sibling call site on the same invariant stays broken is not addressed. `resolve_comment` only the
  earlier findings the fix actually closes; unresolved ones stand.
- A fix with no test reproducing the failure scenario it closes is itself a finding — nothing else
  stops the same regression next time an unrelated change touches the same lifecycle.

## The verdict

Exactly one `review_verdict` per package, after the work above — never before:
- `approve` — no findings that block; note may name accepted debt.
- `request_changes` — your comments must be addressed; the note is one line naming the biggest one.
Approving without having read the diff, or requesting changes without a filed comment, are both failures.
