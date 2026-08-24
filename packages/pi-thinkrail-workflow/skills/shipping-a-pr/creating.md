# creating.md — gates, then the PR

Entry: finished work on a branch, no PR yet. Saves the body draft at
`.thinkrail/context/pr-body.md`. Control continues at `screenshots.md` (UI-visible change) or
`checks.md`.

## Gates — all four pass before `gh pr create`, in this order

1. **Fresh base.** `git fetch origin`, then rebase onto the base branch (default `origin/main`).
   Conflicts are resolved now, not after review starts.
2. **Clean branch.** Remove throwaway artifacts — repro tests, capture specs, scratch files, test
   output dirs. Read `git log --oneline <base>..HEAD` and `git status --short` as the reviewer will:
   every file in the diff must be explainable in one line.
3. **Verified.** Run the project's own verification gates (its agent instructions / package
   scripts) — *after* the rebase, not before. New behavior ships with tests; if the project's
   convention demands a suite class (e.g. e2e) not yet run for this change, run it now.
4. **Self-review.** Re-read the full diff (`git diff <base>...HEAD` plus working tree) as a
   reviewer, holding the project's handoff-hygiene bar: no silent lint/type suppressions, no comment
   creep, no half-migrated patterns, no leftovers. Fix what you find; don't annotate it.

Red flags — stop, a gate is being rationalized away:

- "I'll create the PR now and run the suite while it's up."
- "The rebase can wait until review starts."
- "That file is probably fine" — you couldn't explain it to a reviewer in one line.

## The PR

- **Title**: `scope: imperative summary` — e.g. `feat(web): …`, `fix(website): …`, `ci: …`.
- **Body** → `.thinkrail/context/pr-body.md`, sections scaled to the change, written for colleagues:
  - `## Summary` — what and why; `Closes #NNN` when issue-driven.
  - `## Changes` — grouped by module (larger PRs); note deliberate scope exclusions and any
    migration steps.
  - `## Testing` — the actual commands run and their results ("`bun run e2e` — 252 passed"), never
    a bare "tests pass".
- **Create**:
  `gh pr create --base <base> --head <branch> --title "…" --body-file .thinkrail/context/pr-body.md`
  — add `--repo` when the remote is ambiguous; `--draft` only when the user asked for a draft.
  Never pass the body inline: long inline/heredoc bodies have truncated and failed; the body file
  *is* the recipe. Delete the body file once the PR exists.

## Next

- The change is UI-visible → offer screenshots proactively (don't wait to be asked) and continue at
  `screenshots.md`.
- Otherwise → `checks.md`.
