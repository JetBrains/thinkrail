# checks.md — observe, then either wait or report

Entry: an open PR plus the completion mode selected by the caller. Saves nothing. This doc ends the
workflow in one of the two terminal states below.

## Snapshot mode — metadata-only work

Use after standalone screenshot, body, or comment-only maintenance that left the PR head unchanged,
or for a one-time checks/merge-state request, when the ask does not promise a merge-ready result.

1. Run `gh pr checks <n>` once. Preserve `no checks reported` as the explicit state “no checks
   configured”; report pending or failing checks as observed.
2. Query merge state once (`gh pr view <n> --json mergeStateStatus -q .mergeStateStatus`). Report
   `UNKNOWN`, `BEHIND`, or `DIRTY` exactly as observed; do not poll, sync, rerun, or repair it.
3. Give the user the PR link, any metadata action completed, and the current checks + merge-state
   snapshot.

**Snapshot terminal state:** the requested metadata mutation, if any, is complete and the current PR
state is reported. This is not a claim that the PR is green or merge-ready.

## Wait mode — ship or code-affecting work

### Watch

- `gh pr checks <n> --watch` (or `gh run watch <run-id> --exit-status` for one run). When a watch is
  impractical, poll `gh pr checks <n>` with sleeps.
- `no checks reported` means there is no CI to wait for; carry “no checks configured” into the
  terminal summary and continue to merge-state verification.
- On failure, inspect `gh run view --job <job-id> --log-failed`; reproduce locally when the log is not
  conclusive.

### React

- Fix failures caused by the branch, commit, push, and restart the loop. A flaky-looking failure is
  investigated rather than rerun into submission; use `gh run rerun --failed` once and only when the
  failure is demonstrably unrelated to the branch.
- If green is unreachable without a user decision or work outside the request, report the blocker and
  stop rather than expanding scope.

### Verify the base

Query `gh pr view <n> --json mergeStateStatus -q .mergeStateStatus` after checks resolve:

- `UNKNOWN` — wait briefly and re-query until GitHub computes the state.
- `BEHIND` or `DIRTY` — read and follow `syncing.md`, then return here in wait mode.
- Any other computed state is the affirmative non-behind, non-conflicted result.

**Wait terminal state:** the PR exists, is current with its base, every configured check is green (or
there is explicitly no CI), and the user has the link plus what shipped, what was verified, and any
deliberate exclusions. A user-decision blocker is the alternative terminal state and is reported
explicitly.
