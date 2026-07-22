---
id: submodule-server-git
type: submodule-design
status: active
title: git — runner + worktree status/diff
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Git plumbing: the low-level `git` runner (sync + async) plus a worktree's changed files and diffs vs its
base branch, a project repo's branch list for the New-Workspace base picker, and a background prefetch that
warms a remote base ref off the workspace-create critical path.

## Boundary

- **Owns:** `git(cwd, args)` (spawn git *sync*, capture trimmed stdout/stderr + ok; `opts.raw` keeps
  stdout byte-exact for file-content reads) and `gitAsync(cwd,
  args)` (its async twin — `Bun.spawn`, off the event loop, for network-bound ops like `fetch` that must
  not block the host); `gitStatus(workspaceId)` — changed files vs the base branch plus untracked;
  `gitDiffFile(workspaceId, path)` → `{ original, modified }` — both sides of one file's change for the
  center Monaco diff tab (`original` = `git show base:path`, raw, empty when absent there — untracked/
  added, or a renamed file's new path, degrading to an add-style diff; `modified` = the worktree file,
  empty when deleted; the path is escape-checked against the worktree root); `listBranches(projectId)` → `{ local, remote,
  defaultBranch }` (local `refs/heads`, remote `refs/remotes/origin` minus `origin/HEAD`, default =
  `origin/HEAD`→`origin/main`→repo `HEAD`); `prefetchBranch(projectId, ref)` — best-effort background
  `git fetch` of a remote ref (via `gitAsync`, branch passed after `--` so a `-`-prefixed name can't be
  parsed as a git option), so a later `createWorkspace` branches off a fresh tip without the network
  round-trip on its critical path (non-`origin/` ref / offline → no-op).
- **Public surface (barrel):** `git`, `gitAsync`, `gitStatus`, `gitDiffFile`, `listBranches`, `prefetchBranch`.
- **Allowed deps:** `persistence` (workspace + project lookup); `contracts` (`Git*`/`BranchList` types);
  Bun (spawn).
- **Forbidden:** `host`; sibling features.
