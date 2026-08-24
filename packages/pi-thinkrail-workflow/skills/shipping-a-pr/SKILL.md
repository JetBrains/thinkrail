---
name: shipping-a-pr
description: "Use when finished work needs to ship as a pull request, or when the ask is about a PR — creating one, bringing it up to date, adding screenshots, watching its checks, or addressing its review comments. Not for reviewing a PR you are not shipping."
---

# Shipping a PR

The PR lifecycle: ship the workspace's finished work as a pull request and keep that PR healthy
until it is mergeable. One workflow, five phases as sibling docs — enter at the phase the ask names.

## The done bar (applies to every phase)

A PR is **done** when every check it *has* is green — a repo with no CI is reported as exactly
that, never silently treated as green — and the user has the link plus its current state; never at
"PR opened", "pushed", or "comment replied". Every phase below therefore ends in `checks.md`,
which declares this workflow's terminal state.

## Observed, never assumed (applies to every phase)

Git and GitHub state is concurrent and mutable: the base moves, CI lags, mergeability is computed
lazily, and this workflow's own steps dirty the tree they just checked. Three rules hold at every
step of every phase:

- **Verify at the point of action.** An irreversible step — push, `gh pr create`, `gh pr edit`,
  replying to a thread, declaring done — re-checks the exact state it consumes immediately before
  running. A gate passed earlier does not survive the mutations made since it passed.
- **Fetch, don't remember.** Remote state is read fresh and completely at the moment it's needed:
  the current body before editing it, `--paginate` on every listing, `git fetch` before reasoning
  about the base.
- **Indeterminate is not affirmative.** A pending or still-computing answer (an `UNKNOWN` merge
  state, queued checks) is polled until it resolves; done is declared only from observed
  affirmative state, never from the absence of a bad signal.

## Classify the ask

| The ask | Phase doc |
|---|---|
| Create a PR — the work is finished | `creating.md` |
| Bring the PR up to date / resolve conflicts with its base | `syncing.md` |
| Add or refresh screenshots on a PR | `screenshots.md` |
| Monitor CI / investigate or fix failing checks | `checks.md` |
| Address review comments | `review-comments.md` |

**Read and follow the selected phase doc** — the gates and mechanics live only there; never run a
phase from this spine's summary. A compound ask ("rebase, verify, and create a PR") is one flow: start at the earliest phase named;
the docs chain forward on their own. If the work itself isn't finished — the ask bundles new design
or implementation before the ship — that part is not this workflow's; route it per
choosing-a-workflow first and come back here when it lands.

## Working files

Ephemeral files this workflow uses, all under the workspace's gitignored `.thinkrail/context/`:

- `pr-body.md` — the PR body draft; always passed via `--body-file`, never inline.
- `pr-shots/` — staged before/after screenshots awaiting attachment.

Both are deleted when the phase that made them completes (screenshots stay while the user is
uploading by hand — see `screenshots.md`).

## Ending

Every path ends in `checks.md`; its terminal state is the only way this workflow finishes.
