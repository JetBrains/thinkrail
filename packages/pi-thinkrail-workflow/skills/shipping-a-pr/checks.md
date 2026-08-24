# checks.md — watch, react, report (terminal)

Entry: an open PR with fresh commits, or a standing ask to monitor. Saves nothing. This doc ends
the workflow — the terminal state is declared below.

## Watch

- `gh pr checks <n> --watch` (or `gh run watch <run-id> --exit-status` for one run). When a watch
  is impractical, poll `gh pr checks <n>` with sleeps.
- `no checks reported` (a repo with no CI) is an observed state, not an error: there is nothing to
  watch, fix, or wait for — go straight to the merge-state verification below and carry "no checks
  configured" into the terminal summary.
- On failure: `gh run view --job <job-id> --log-failed` for the failing step's log; reproduce
  locally when the log isn't conclusive.

## React

- Fix, commit, push; the loop restarts. A flaky-looking failure is investigated, not re-run into
  submission — `gh run rerun --failed` once, and only when the failure is demonstrably unrelated to
  the branch.
- Never report a check green on hope: the report below is written from observed check states only.

## Before declaring done: the base, not just CI

Checks only observe CI — they say nothing about the base moving underneath. Query the merge state
(`gh pr view <n> --json mergeStateStatus -q .mergeStateStatus`) and act on the answer:

- `UNKNOWN` — GitHub is still computing mergeability (normal right after a push): wait a few
  seconds and re-query until it resolves. An indeterminate answer never falls through to done.
- `BEHIND` or `DIRTY` — read and follow `syncing.md`, then return here.
- Any other value is a computed, non-behind, non-conflicted state — the affirmative answer the
  terminal state below requires.

Only a head *observed* current with its base is reported done — never one assumed current because
nothing said otherwise.

## Terminal state (this workflow ends here)

Done means: the PR exists, is up to date with its base, every check it *has* is **green** — a repo
with no CI is reported explicitly as "no checks configured", never silently treated as green — and
the user has the PR link plus a short state summary — what shipped, what was verified, anything deliberately
left out. If green is unreachable without a decision that belongs to the user (e.g. a required
check failing for reasons outside this branch's scope), report that state explicitly and stop —
that is the alternative terminal state, stated as such, never silently abandoned.
