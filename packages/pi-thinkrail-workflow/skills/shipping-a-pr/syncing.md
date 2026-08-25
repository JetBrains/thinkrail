# syncing.md — bring the PR up to date

Entry: an open PR has fallen behind its base or has conflicts. Saves nothing. Control continues at
`checks.md`.

1. `git fetch origin`, then rebase the branch onto the base — or merge, if the PR's existing
   history style is merge-based; follow what the PR already does.
2. Resolve conflicts by understanding both sides: read the conflicting hunks' history
   (`git log -p` on each side) before choosing. A mechanical "take ours" is how freshly merged
   work gets silently reverted.
3. **Re-verify.** A conflict-free rebase is not a green rebase — run the project's gates again: at
   minimum the suites covering the conflicted areas, the full bar when the base moved substantially.
4. Push — but first commit anything step 3 changed and confirm `git status --porcelain` is empty
   (the spine's point-of-action rule: a re-verification fix left in the working tree does not
   reach the PR). `--force-with-lease` after a rebase, never plain `--force`.

Red flag: "no conflicts, so nothing to re-run" — the base may have changed behavior this branch
depends on; step 3 is unconditional.

## Next

Read and follow `checks.md`.
