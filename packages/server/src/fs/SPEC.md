---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — worktree file reads
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Read directories and UTF-8 files inside a workspace's worktree, path-contained.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first.
- **Public surface (barrel):** `readDir`, `readFile`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`); Node `fs`/`path`.
- **Forbidden:** `host`; sibling features.
