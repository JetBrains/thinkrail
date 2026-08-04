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
- **Repo-metadata nudge (second seam):** a git-metadata write is *metadata, not content*, so it never
  becomes an `fsChanged` path (the `.git` blackout stands — plumbing storms must not turn into frames). It
  instead arms a separately debounced (300ms), **pathless** `setRepoMetaPublisher(workspaceId)` nudge. This
  is the only signal for a change that leaves the working tree byte-identical: `git switch -c <new-branch>`
  writes nothing outside the git dir, and a `git commit` moves `HEAD` without touching a worktree file.
  It is deliberately **not** matched on specific paths (`.git/HEAD`, `.git/logs/HEAD`, …): the platform
  streams coalesce and report *a* representative path per burst, so which git-internal path surfaces is not
  reliable. A wildcard event (null filename) nudges it too. Two sources feed the one nudge:
  - `.git`-prefixed events seen by the recursive **root** watcher — covers a **repo root** workspace, whose
    `.git` directory lives inside the watched tree;
  - a second, **non-recursive** watcher on the worktree's git dir **when that dir lies outside the root**
    (a repo root's in-tree `.git` directory is already covered above, so it is never watched twice): for a
    *linked worktree* (every workspace this app creates) `.git` is a *file* (`gitdir: <path>`) pointing at
    `<repo>/.git/worktrees/<name>`, i.e. **outside the watched root**, so a commit made in that worktree's
    terminal would otherwise produce no signal at all. Resolved with plain fs (stat + parse the gitfile
    line), never by shelling out — this module has no `git` sibling edge. Non-recursive because only the
    dir's top level holds the refs that move (`HEAD`, `index`, `ORIG_HEAD`) while `objects/`/`logs/` are
    pure storms; a missing/unreadable git dir (non-git folder) or a failed start degrades silently.

  `host` fans the nudge out to two convergences: `refreshDefaultWorkspace` (a **Default** workspace's
  folder-truth branch labels) **and** a pathless `fsChanged` frame (`paths: []`, `truncated: false`) so the
  clients' git-derived reads re-read — `git.status` and an open `uncommitted`-scope diff tab are relative to
  `HEAD`, and would otherwise keep reporting a committed change as uncommitted until the next file edit.
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
- **Public surface (barrel):** `ensureWatch`, `stopWatch`, `stopAllWatches`, `setWatchPublisher`,
  `setRepoMetaPublisher`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (payload type); Bun/Node.
- **Forbidden:** `host`; sibling features; any pi package.
