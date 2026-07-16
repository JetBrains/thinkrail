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
  root; `.git` hidden; directories sorted first. (`.thinkrail/` is **not** hidden — it is shown like any
  other dir, so future host-managed content there stays visible; its ephemeral `context/` is kept out of
  git, not out of the tree.) **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path (same escape guard) for the host to stream a file's raw bytes over HTTP (the
  `/files/…` route serving relative images in the markdown viewer) — this module owns the path safety;
  the host owns the streaming.
- **Public surface (barrel):** `readDir`, `readFile`, `resolveWorktreeFile`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`); Node `fs`/`path`.
- **Forbidden:** `host`; sibling features.
