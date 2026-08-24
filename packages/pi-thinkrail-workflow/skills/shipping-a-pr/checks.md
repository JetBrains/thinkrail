# checks.md — watch, react, report (terminal)

Entry: an open PR with fresh commits, or a standing ask to monitor. Saves nothing. This doc ends
the workflow — the terminal state is declared below.

## Watch

- `gh pr checks <n> --watch` (or `gh run watch <run-id> --exit-status` for one run). When a watch
  is impractical, poll `gh pr checks <n>` with sleeps.
- On failure: `gh run view --job <job-id> --log-failed` for the failing step's log; reproduce
  locally when the log isn't conclusive.

## React

- Fix, commit, push; the loop restarts. A flaky-looking failure is investigated, not re-run into
  submission — `gh run rerun --failed` once, and only when the failure is demonstrably unrelated to
  the branch.
- Never report a check green on hope: the report below is written from observed check states only.

## Terminal state (this workflow ends here)

Done means: the PR exists, is up to date with its base, its checks are **green**, and the user has
the PR link plus a short state summary — what shipped, what was verified, anything deliberately
left out. If green is unreachable without a decision that belongs to the user (e.g. a required
check failing for reasons outside this branch's scope), report that state explicitly and stop —
that is the alternative terminal state, stated as such, never silently abandoned.
