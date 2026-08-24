# screenshots.md — before/after evidence for reviewers

Entry: a PR exists (or was just created) for a UI-visible change. Saves PNGs under
`.thinkrail/context/pr-shots/` and rewrites the PR body to reference them. Control continues at
`checks.md`.

## Capture

- **After** = the scenario on the branch build; **Before** = the *same* scenario at the base branch
  (check out detached, rebuild, capture, return). Same viewport, same scenario — the pair must diff
  visually.
- Capture with whatever drives the app in this project: the e2e harness with a throwaway capture
  spec, or a browser-automation session against a running dev host. A capture spec is a throwaway —
  it never ships, and *this* doc owns its cleanup (Next below): creating.md's clean-branch gate has
  already run on every entry path here and will not catch it.
- Stage the picked shots as `.thinkrail/context/pr-shots/<name>.png` with names a reviewer reads
  (`loader-before-gap.png`, `loader-after-working.png`).

## Attach — review-only assets ref (the default)

Screenshots never enter the PR's file tree. Push them as an orphan ref and reference SHA-pinned
URLs:

```bash
TREE_INPUT=""
for f in .thinkrail/context/pr-shots/*.png; do
  sha=$(git hash-object -w "$f")
  TREE_INPUT+=$(printf '100644 blob %s\t%s' "$sha" "$(basename "$f")")$'\n'
done
TREE=$(printf '%s' "$TREE_INPUT" | git mktree)
COMMIT=$(printf 'PR screenshots (review-only ref)\n' | git commit-tree "$TREE")
git push -f origin "$COMMIT:refs/heads/assets/<topic>"
```

Then update the body — **never rebuild it**: fetch the current one first
(`gh pr view <n> --json body -q .body > .thinkrail/context/pr-body.md`), add or update a
`## Screenshots` section in it referencing each image as
`https://github.com/<owner>/<repo>/blob/<COMMIT>/<name>.png?raw=true` (pinned to the pushed commit
SHA so later branch pushes never break the images), then
`gh pr edit <n> --body-file .thinkrail/context/pr-body.md` and delete the file. A body built from
scratch here would erase the PR's summary, testing notes, and issue links.

Fallback (the user sometimes prefers it): leave the PNGs staged and hand over their paths — the
user drags them into GitHub by hand. Offer the choice only when the user has signaled it; the
assets ref is the default.

## Next

Clean up this phase's throwaways once the body edit lands: delete `.thinkrail/context/pr-shots/`
(unless the user is uploading by hand — then leave it until they confirm) and every capture
scaffold (specs, throwaway builds). If any scaffolding was committed, the commit that removes it
is pushed too — a deletion left in the working tree ships nothing. Read and follow `checks.md`.
