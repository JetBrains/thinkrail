# body.md — maintain PR title or body

Entry: an open PR plus a requested title/body change. Saves `.thinkrail/context/pr-body.md` only while
editing the body. Default completion is snapshot mode; an explicit watch/ship/merge-ready ask selects
wait mode.

1. Fetch the current title and body (`gh pr view <n> --json title,body`) and read the repository's
   `.github/PULL_REQUEST_TEMPLATE.md` when present. Preserve existing sections, issue links, checklist
   items, and unrelated content; apply only the requested mutation.
2. For a body edit, write the complete candidate to `.thinkrail/context/pr-body.md`. Immediately before
   `gh pr edit`, fetch the current body again; if it changed, merge the requested mutation into that
   fresh body instead of overwriting concurrent edits. Use `gh pr edit <n> --body-file ...`, never an
   inline body. For a title edit, immediately re-fetch the current title too; if it changed, reapply
   only the requested mutation to that fresh title before `gh pr edit <n> --title ...`.
3. Fetch the resulting title/body once to verify the requested mutation landed, then delete the body
   file.

## Next

Read and follow `checks.md` in snapshot mode by default. Use wait mode only when the caller explicitly
asked to watch, ship, or make the PR merge-ready.
