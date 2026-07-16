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
  root; **host-managed internals hidden** (`.git` and ThinkRail's own `.thinkrail/` —
  `WORKSPACE_INTERNAL_DIR`, the per-workspace ephemeral scratch dir) so the tree shows project source
  only; directories sorted first. **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path (same escape guard) for the host to stream a file's raw bytes over HTTP (the
  `/files/…` route serving relative images in the markdown viewer) — this module owns the path safety;
  the host owns the streaming.
- **Public surface (barrel):** `readDir`, `readFile`, `resolveWorktreeFile`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`); `@thinkrail/shared/paths`
  (the `WORKSPACE_INTERNAL_DIR` name to hide); Node `fs`/`path`.
- **Forbidden:** `host`; sibling features.
