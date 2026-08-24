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
`{ workspaceId, paths, truncated, skillChange }`). The frame is an **invalidation nudge, not data** — clients
re-read through the existing read methods (`fs.*` / `git.*` / `spec.graph`), so the reads stay the
single source of truth and a duplicate/replayed frame is harmless (one extra refetch, never wrong
state). Chosen over per-path client-side tree patching (would make the client a second source of
truth) and visible-panel polling (laggy, wasteful over Tailscale).

## Boundary

- **Owns:** the watcher registry + its lifecycle: `ensureWatch(workspaceId)` (idempotent and
  **self-healing**; returns the live watcher's shared readiness promise; started lazily by `host` when a
  workspace read or `workspace.watchReady` preflight lands — the read is the "a client is looking" signal;
  readiness reports whether the watcher was already known ready), `stopWatch(workspaceId)` (called
  in `workspace.remove`'s fast path),
  `stopAllWatches()` (called in `server.stop()`); the ignore filter (any path segment `.git` or
  `node_modules`, plus `.DS_Store`); per-workspace coalescing (deduped relative paths, flushed after
  300ms quiet / 1s max-wait, capped at 100 paths → `truncated: true` = a generic wildcard — the ≤ ~1 frame/sec
  bound is **pinned by the e2e churn canary** in `live-refresh.spec.ts`: ~200 writes over ~3s must
  reach the client as ≤ 8 frames while a mid-storm `/health` round-trip stays fast). Skill relevance is
  accumulated **before and independently of** that cap as `skillChange: "none" | "detected" | "unknown"`:
  `host` injects `agent`'s project-skill path predicate; every concrete event contributes `detected`/`none`
  even when its path cannot be retained, while a null filename contributes `unknown` (`detected` wins). A
  duplicate already in the retained set does not make the batch truncated. Thus a 100+ file build cannot
  masquerade as a skill edit, while a skill path after the cap is still detected. The **startup nudge** — a
  fresh watcher publishes one synthetic **truncated / skill-unknown wildcard** after the platform stream's
  registration window (~750ms), because a write landing inside that window can lose its event forever.
  Its readiness promise resolves only after that publish. The web's skill-loading flows await the typed
  `workspace.watchReady` host preflight *before* capturing their start-of-load freshness tick, so startup
  uncertainty is absorbed into the new session's baseline instead of falsely marking it stale; a real edit
  after readiness stays newer than that baseline. Unless the watcher was already known ready, the result
  tells the web to fold a duplicate `skillChange: "unknown"` fallback if the broadcast died with its socket
  while the request response survived replay — or if startup failed before publishing. Ordinary workspace
  reads do not await readiness and never gain startup latency. Stopping a watcher settles its pending
  readiness and cancels the nudge, so callers cannot
  hang and torn-down watchers cannot publish. An invalidation nudge remains idempotent, so the fallback's
  possible duplicate is one cheap no-op refetch.
- **Prewarm tier (globally bounded):** `ensureWatch(workspaceId, { prewarm: true })` — reached via
  `workspace.watchReady`'s optional `prewarm` flag, the web's pre-selection warm-up — starts the same
  watcher but marks its entry **prewarm-only**. Prewarm-only entries live in one global pool capped at
  **8**: creating one beyond the cap evicts the least-recently-prewarmed prewarm-only entry through
  `stopWatch` (its conservative readiness settle included), so clicking through many projects reuses one
  bounded pool instead of accumulating watchers for one host lifetime. Any **real** call promotes the
  entry out of the tier for good — a watcher activated by a real workspace read or skill-load preflight
  is never evicted — while a prewarm hit on a live prewarm-only entry only refreshes its eviction
  recency, and a prewarm can never demote a real watcher (including across an inode-change
  re-creation). Correctness under eviction rides the existing recovery paths: the next real call
  re-creates the watcher and its fresh conservative startup nudge covers the blind window.
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

  `host` fans the nudge out to two convergences: `refreshUserOwnedWorkspace` (a user-owned workspace's
  folder-truth branch labels) **and** a pathless, skill-neutral `fsChanged` frame (`paths: []`,
  `truncated: false`, `skillChange: "none"`) so the clients' git-derived reads re-read — `git.status` and an
  open `uncommitted`-scope diff tab are relative to `HEAD`, and would otherwise keep reporting a committed
  change as uncommitted until the next file edit.
- **Composition seams:** never imports `host` or `agent` — `host` injects both the publish callback and
  `agent`'s pure project-skill path classifier at wiring time (the publisher-tee pattern). A missing
  classifier degrades concrete events to `skillChange: "unknown"`, never false-clean.
- **Self-healing per read (out-of-band worktree churn is normal — e2e resets, `rm -rf` in a terminal):**
  every `ensureWatch` re-stats the root and **re-creates the watcher when the inode changed** (a
  deleted+recreated path leaves the old stream silently following a dead inode), **reaps zombie
  watchers** whose workspace record no longer exists (a resurrected path-based stream would keep
  publishing for a forgotten id), and **retries a failed start on the next read** (no sticky failure
  marker). A watcher that errors mid-flight (ENOSPC, root deleted) is `console.warn`ed and dropped —
  panels fall back to read-on-demand until a later read re-creates it. No idle-stop in V1 (bounded by
  workspaces actually visited plus the capped prewarm tier).
- **Public surface (barrel):** `ensureWatch`, `stopWatch`, `stopAllWatches`, `setWatchPublisher`,
  `setRepoMetaPublisher`, `setSkillPathClassifier`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (payload type); Bun/Node.
- **Forbidden:** `host`; sibling features; any pi package.
