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

Git plumbing: the low-level `git` runner plus a worktree's changed files and diffs vs its base branch.

## Boundary

- **Owns:** `git(cwd, args)` (spawn git, capture trimmed stdout/stderr + ok); `gitStatus`/`gitDiff(
  workspaceId, path?)` — changes vs the base branch, untracked files listed and shown in full via
  `--no-index`.
- **Public surface (barrel):** `git`, `gitStatus`, `gitDiff`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`Git*` types); Bun (spawn).
- **Forbidden:** `host`; sibling features.
