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
  `Workspace.baseBranch` records the base the diff is measured against; **branch name made unique
  against refs *and* worktree dirs** — archiving leaves the branch behind and renaming frees a branch
  name whose worktree directory stays occupied, so candidate names skip both; path
  `dataDir/worktrees/<project-slug>/<branch>`; a **user-supplied name sets `renamed: true`** at create —
  the user already chose, so the auto-namer never touches it; auto-`workspace-N` leaves it unset),
  `renameWorkspace` (**sync**; slugs + uniques the requested name, `git branch -m` from the project repo
  — the branch ref moves and the worktree's HEAD follows, but the **worktree dir never moves** (pi keys
  sessions by exact cwd; terminals/tabs are cwd'd there — the stale dir name is the accepted cost);
  keeps the `name === branch` invariant by setting both to the final unique branch; sets `renamed: true`;
  **re-points sibling records whose `baseBranch` was the old branch** in the same save so their diffs
  don't silently empty; **re-loads the records after the git subprocess** — a record that vanished
  meanwhile (archived / e2e reset) aborts the save instead of resurrecting it; throws on unknown id or
  git failure — callers decide, the auto-rename hook treats it as best-effort),
  `listWorkspaces` (with diff stats), `removeWorkspace` (`git worktree remove --force`, keeps the branch;
  hardened: rm + `prune` if git fails), `workspaceDiffStats`, `getWorkspace` (by-id lookup, throws on
  unknown — anchors a chat session's cwd).
- **Public surface (barrel):** `createWorkspace`, `listWorkspaces`, `removeWorkspace`,
  `workspaceDiffStats`, `getWorkspace`, `renameWorkspace`.
- **Allowed deps:** `projects` (repo lookup), `git` (the runner), `persistence`; `contracts`; Node.
- **Forbidden:** `host`; reaching into another feature's internals (use its barrel).
