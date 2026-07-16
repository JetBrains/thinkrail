---
id: submodule-server-watch
type: submodule-design
status: active
title: watch — worktree change notifier
parent: module-server
depends-on: [module-contracts]
tags: [v1, live-refresh]
---

## Responsibility

The filesystem change notifier behind the UI's live refresh: one recursive watcher per watched
workspace worktree (Bun's native `fs.watch(root, { recursive: true })` — no watcher dependency),
coalescing events into a debounced **`workspace.fsChanged`** publish (`WorkspaceFsChangedPayload`:
`{ workspaceId, paths, truncated }`). The frame is an **invalidation nudge, not data** — clients
re-read through the existing read methods (`fs.*` / `git.*` / `spec.graph`), so the reads stay the
single source of truth and a duplicate/replayed frame is harmless (one extra refetch, never wrong
state). Chosen over per-path client-side tree patching (would make the client a second source of
truth) and visible-panel polling (laggy, wasteful over Tailscale).

## Boundary

- **Owns:** the watcher registry + its lifecycle: `ensureWatch(workspaceId)` (idempotent and
  **self-healing**; started lazily by `host` when a workspace read lands — the read *is* the "a client
  is looking" signal), `stopWatch(workspaceId)` (called in `workspace.remove`'s fast path),
  `stopAllWatches()` (called in `server.stop()`); the ignore filter (any path segment `.git` or
  `node_modules`, plus `.DS_Store`); per-workspace coalescing (deduped relative paths, flushed after
  300ms quiet / 1s max-wait, capped at 100 paths → `truncated: true` = wildcard — the ≤ ~1 frame/sec
  bound is **pinned by the e2e churn canary** in `live-refresh.spec.ts`: ~200 writes over ~3s must
  reach the client as ≤ 8 frames while a mid-storm `/health` round-trip stays fast); the **startup
  nudge** — a fresh watcher publishes one synthetic wildcard batch after the platform stream's
  registration window (~750ms), because a write landing inside that window is otherwise lost forever
  (an invalidation nudge is idempotent, so the cost is one cheap no-op refetch).
- **Publish seam:** never imports `host` — `host` injects the publish callback at wiring time (the
  session-publisher tee pattern).
- **Self-healing per read (out-of-band worktree churn is normal — e2e resets, `rm -rf` in a terminal):**
  every `ensureWatch` re-stats the root and **re-creates the watcher when the inode changed** (a
  deleted+recreated path leaves the old stream silently following a dead inode), **reaps zombie
  watchers** whose workspace record no longer exists (a resurrected path-based stream would keep
  publishing for a forgotten id), and **retries a failed start on the next read** (no sticky failure
  marker). A watcher that errors mid-flight (ENOSPC, root deleted) is `console.warn`ed and dropped —
  panels fall back to read-on-demand until a later read re-creates it. No idle-stop in V1 (bounded by
  workspaces actually visited).
- **Public surface (barrel):** `ensureWatch`, `stopWatch`, `stopAllWatches` (+ the publish-callback
  setter/factory as implemented).
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (payload type); Bun/Node.
- **Forbidden:** `host`; sibling features; any pi package.
