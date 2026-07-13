---
id: submodule-server-fs
type: submodule-design
status: active
title: fs — worktree file reads + guarded write
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Read directories and UTF-8 files inside a workspace's worktree, path-contained, plus a single
**user-initiated** guarded write (`writeFile`) — the Revert path for inline-editing. Agent edits never
use this; they go through pi.

## Boundary

- **Owns:** `readDir`/`readFile(workspaceId, path)` — every path resolved + contained to the worktree
  root; `.git` hidden; directories sorted first. **`resolveWorktreeFile(workspaceId, path)`** returns the
  contained absolute path (same escape guard) for the host to stream a file's raw bytes over HTTP (the
  `/files/…` route serving relative images in the markdown viewer) — this module owns the path safety;
  the host owns the streaming.
  **`writeFile(workspaceId, path, content, ifMatchContent?)`** persists a UTF-8 file (same escape guard);
  `ifMatchContent` is optimistic-concurrency (throws `File changed on disk` on mismatch). It is only ever
  called for a direct user action (Revert), never for an agent-driven edit.
- **Public surface (barrel):** `readDir`, `readFile`, `writeFile`, `resolveWorktreeFile`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (`FileNode`); Node `fs`/`path`.
- **Forbidden:** `host`; sibling features.
