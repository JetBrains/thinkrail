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

Git plumbing: the low-level `git` runner plus a worktree's changed files and diffs vs its base branch, and
a project repo's branch list for the New-Workspace base picker.

## Boundary

- **Owns:** `git(cwd, args)` (spawn git, capture trimmed stdout/stderr + ok); `gitStatus`/`gitDiff(
  workspaceId, path?)` — changes vs the base branch, untracked files listed and shown in full via
  `--no-index`; `listBranches(projectId)` → `{ local, remote, defaultBranch }` (local `refs/heads`, remote
  `refs/remotes/origin` minus `origin/HEAD`, default = `origin/HEAD`→`origin/main`→repo `HEAD`).
- **Public surface (barrel):** `git`, `gitStatus`, `gitDiff`, `listBranches`.
- **Allowed deps:** `persistence` (workspace + project lookup); `contracts` (`Git*`/`BranchList` types);
  Bun (spawn).
- **Forbidden:** `host`; sibling features.
