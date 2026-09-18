# syncing.md — bring the PR up to date

Entry: an open PR has fallen behind its base or has conflicts. Saves nothing. Syncing preserves the
caller's completion mode and defaults to snapshot mode when entered directly; control continues at
`checks.md`.

1. `git fetch origin`, then rebase the branch onto the base — or merge, if the PR's existing
   history style is merge-based; follow what the PR already does.
2. Resolve conflicts by understanding both sides: read the conflicting hunks' history
   (`git log -p` on each side) before choosing. A mechanical "take ours" is how freshly merged
   work gets silently reverted.
3. **Reassess verification evidence.** Reuse checks that still cover the resulting change. Run only
   the project's gates invalidated by conflict resolution, relevant dependency changes, or base commits
   that touch the change's behavior or test surface; use the full bar only when the base moved
   substantially enough to invalidate it. A conflict-free ancestry-only rebase does not force a rerun.
4. Push — but first commit anything step 3 changed and confirm `git status --porcelain` is empty
   (the spine's point-of-action rule: a re-verification fix left in the working tree does not
   reach the PR). `--force-with-lease` after a rebase, never plain `--force`.

Red flags: "a rebase happened, so rerun everything" ignores valid evidence; "no conflicts, so every
old result still applies" ignores relevant behavior or dependency changes. Reassessing evidence is
unconditional; rerunning commands is not.

## Next

Read and follow `checks.md` in the selected completion mode.
