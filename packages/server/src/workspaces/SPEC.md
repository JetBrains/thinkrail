---
id: submodule-server-workspaces
type: submodule-design
status: active
title: workspaces — git worktrees
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

A workspace is a `git worktree` on its own branch under the data dir — the anchor for files/git/terminals/
chats.

## Boundary

- **Owns:** `createWorkspace` (**async**; off `baseRef` when given — branched with `worktree add -b`, never a detached
  remote checkout; off the repo `HEAD` otherwise; **remote-ref freshness is prefetched off this critical
  path** — the New-Workspace dialog `git.prefetch`es the base in the background, so create only `git
  fetch`es as a cheap fallback when the local remote-tracking ref is missing entirely — that fallback runs
  via `gitAsync` (network must not block the event loop) with the branch passed after `--`;
  `Workspace.baseBranch` records the base the diff is measured against; **branch name made unique** —
  archiving leaves the branch behind, so re-creating must not collide; path
  `dataDir/worktrees/<project-slug>/<branch>`),
  `listWorkspaces` (with diff stats), `removeWorkspace` (`git worktree remove --force`, keeps the branch;
  hardened: rm + `prune` if git fails), `workspaceDiffStats`.
- **Public surface (barrel):** `createWorkspace`, `listWorkspaces`, `removeWorkspace`, `workspaceDiffStats`.
- **Allowed deps:** `projects` (repo lookup), `git` (the runner), `persistence`; `contracts`; Node.
- **Forbidden:** `host`; reaching into another feature's internals (use its barrel).
