---
name: shipping-a-pr
description: "Use when finished work needs to ship as a pull request, or when creating, syncing, updating metadata, checking status, monitoring CI, or addressing review comments on a PR. Not for reviewing a PR you are not shipping."
---

# Shipping a PR

The PR lifecycle: ship the workspace's finished work, maintain PR metadata, and keep the PR healthy
when requested. One workflow, six phases as sibling docs — enter at the phase the ask names.

## Completion modes

- **Snapshot mode is the default** for creating, syncing, or updating a PR and for one-time status
  requests. Take one fresh checks and merge-state snapshot, report pending/failing/indeterminate state
  as observed, and stop without polling or fixing unrelated state. A push never upgrades the mode by
  itself.
- **Wait mode requires an explicit remote-completion ask**: monitor or watch checks, investigate CI,
  wait until green, or make the PR merge-ready. Done means every configured check is green, the head
  is current with its base, and GitHub reports an affirmative merge state; a requested draft is
  reported as draft, never merge-ready. A repo with no CI is reported as exactly that, never silently
  green.

## Observed, never assumed (applies to every phase)

Git and GitHub state is concurrent and mutable: the base moves, CI lags, mergeability is computed
lazily, and this workflow's own steps dirty the tree they just checked. Four rules hold at every
step of every phase:

- **Verify at the point of action.** An irreversible step — push, `gh pr create`, `gh pr edit`,
  replying to a thread, declaring done — re-checks the exact state it consumes immediately before
  running. A gate passed earlier does not survive the mutations made since it passed.
- **Keep verification tied to the final tree.** Reuse exact prior results while the inputs they cover
  remain unchanged. Before every code-affecting push, run project-required checks that are missing or
  invalidated by later code, configuration, dependency, base, or conflict-resolution changes. If a
  check, cleanup, or self-review causes another relevant edit, reassess and repeat before pushing.
- **Fetch, don't remember.** Remote state is read fresh and completely at the moment it's needed:
  the current body before editing it, `--paginate` on every listing, `git fetch` before reasoning
  about the base.
- **Indeterminate is not affirmative.** In wait mode, a pending or still-computing answer (an
  `UNKNOWN` merge state, queued checks) is polled until it resolves; done is declared only from
  observed affirmative state. In snapshot mode, report it as indeterminate without turning the
  phase into a watch.

## Classify the ask

| The ask | Phase doc | Default mode |
|---|---|---|
| Create a PR — the work is finished | `creating.md` | snapshot |
| Bring the PR up to date / resolve conflicts with its base | `syncing.md` | snapshot |
| Update the PR title or body | `body.md` | snapshot |
| Add or refresh screenshots on a PR | `screenshots.md` | snapshot |
| Report the current checks / merge state once | `checks.md` | snapshot |
| Monitor CI / investigate or fix failing checks | `checks.md` | wait |
| Address review comments | `review-comments.md` | snapshot |

**Read and follow the selected phase doc** — the gates and mechanics live only there; never run a
phase from this spine's summary. Carry the completion mode selected above into that doc; a later push
does not change it. A compound ask ("rebase, verify, and create a PR") is one flow:
start at the earliest phase named; the docs chain forward on their own. If the work itself isn't
finished — the ask bundles new design or implementation before the ship — that part is not this
workflow's; route it per choosing-a-workflow first and come back here when it lands.

## Working files

Ephemeral files this workflow uses, all under the workspace's gitignored `.thinkrail/context/`:

- `pr-body.md` — the PR body draft; always passed via `--body-file`, never inline.
- `pr-shots/` — staged before/after screenshots awaiting attachment.

Both are deleted when the phase that made them completes (screenshots stay while the user is
uploading by hand — see `screenshots.md`).

## Ending

Every phase ends through `checks.md` in the completion mode selected above.
