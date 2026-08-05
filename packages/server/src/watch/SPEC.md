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
  reliable. A wildcard event (null filename) nudges it too. Three sources feed the one nudge:
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
  - a third seam, a **watcher pair** on the **project repo's own git dir** (`<project.path>/.git`, resolved
    with plain fs `stat` — it is always a real directory, never a gitfile pointer, because every project
    this app opens is a repo's main working tree, not a linked worktree). A project has **one** repo but
    **many** workspaces, so this is **one watcher pair per project, never per workspace**: it fans out to
    every currently-watched workspace of that project, reusing the exact same per-workspace debounce
    (`scheduleRepoMeta`) — no second debounce mechanism. It is the only seam that can see a **shared** ref
    move (`refs/heads/*`, `packed-refs`) that lives in the repo's common dir, which no per-worktree watcher
    (root or linked-gitdir, above) ever looks at.

    **Why a pair, not one watcher — measured empirically on darwin, not assumed.** The linked-worktree
    watcher above gets away with a single non-recursive watch because the refs that move for *it* (`HEAD`,
    `index`, `ORIG_HEAD`) sit at the watched dir's top level. That does not hold here: `refs/heads/<name>`
    — what a plain `git branch <name>` writes — is *two levels* below `<project.path>/.git`, and
    non-recursive `fs.watch` on darwin is a direct-children-only view (kqueue semantics): it structurally
    cannot see two levels down. Measured directly (repeated clean trials, non-recursive watch on a real
    repo's `.git`, real `git branch`): a plain nested write is **never** observed once the watcher has
    settled; a real `git branch` fired only **~50%** of the time in a 12-trial sample, and every firing was
    attributed to a top-level `rename` of `HEAD.lock` — which `git branch` does not touch — an FSEvents
    coalescing/mis-attribution artifact, not a dependable signal. A single *fully*-recursive watch rooted at
    `<project.path>/.git` was tried too and rejected: it would storm on every object write during a
    `fetch`/`gc` (`objects/` sits right there, a direct descendant), for a directory every workspace of the
    project shares — non-recursive-vs-fully-recursive was a false choice, not the real design space.

    The seam actually shipped is a **pair**: the **non-recursive `<gitDir>` watcher** (unchanged from
    above — top-level churn only: `packed-refs`, the project's own `HEAD`/`index` if checked out and edited
    directly) **plus a second, independently self-healing recursive watcher rooted at `<gitDir>/refs`**
    (`ensureProjectRefsWatch`). Loose refs (`refs/heads/*`, `refs/remotes/*`, `refs/tags/*`) live *only*
    under `refs/`, so rooting the recursion there — instead of at `.git` — gets the reliability recursion
    gives (measured **100%**: a plain `git branch`, watched via a recursive `fs.watch` scoped to
    `<gitDir>/refs` only, fired on every one of 20 independent trials, each attributed directly to the
    `refs/heads/<name>.lock` rename) while EXCLUDING the storm structurally: `objects/` is a *sibling* of
    `refs/`, not a descendant, so it is never seen by this watcher at all — not filtered out, excluded by
    the root chosen. Verified directly against a local bare remote (the same fixture shape as
    `remoteRefs.test.ts`'s `seedRepoWithRemote`): fetching 40 new branches (40 new loose refs under
    `refs/remotes/origin/*`, plus their commits under `objects/`) produced exactly **one** repo-meta frame
    — the 300ms debounce coalesces the whole burst, and the object churn contributes nothing because it's
    outside `refs/`. `refs/` can be genuinely absent (a freshly-initialised repo before its first loose ref,
    or a repo whose refs are fully packed and its loose-refs tree left sparse/absent) — this degrades the
    same way every other failed watcher start in this module does: `null`ed out and retried on the next
    `ensureWatch`, never a sticky failure. Together the two storage forms of a ref are covered: loose under
    `refs/` (the new recursive watcher) and packed in `packed-refs` (the existing non-recursive one) — see
    `.superpowers/sdd/2026-08-04-remote-awareness/task-7-report.md` for the full before/after measurement.

  `host` fans the nudge out to two convergences: `refreshDefaultWorkspace` (a **Default** workspace's
  folder-truth branch labels) **and** a pathless `fsChanged` frame (`paths: []`, `truncated: false`) so the
  clients' git-derived reads re-read — `git.status` and an open `working-tree`- or `staged`-scope diff tab
  read the index, and would otherwise keep reporting stale state until the next file edit.
- **Publish seam:** never imports `host` — `host` injects the publish callback at wiring time (the
  session-publisher tee pattern).
- **Self-healing per read (out-of-band worktree churn is normal — e2e resets, `rm -rf` in a terminal):**
  every `ensureWatch` re-stats the root and **re-creates the watcher when the inode changed** (a
  deleted+recreated path leaves the old stream silently following a dead inode), **reaps zombie
  watchers** whose workspace record no longer exists (a resurrected path-based stream would keep
  publishing for a forgotten id), and **retries a failed start on the next read** (no sticky failure
  marker). A watcher that errors mid-flight (ENOSPC, root deleted) is `console.warn`ed and dropped —
  panels fall back to read-on-demand until a later read re-creates it. No idle-stop in V1 (bounded by
  workspaces actually visited). The **project git-dir watcher pair** (above) is self-healing the same
  way, and independently for each half: `ensureWatch` re-stats `<gitDir>` on every call and re-creates
  *both* watchers together on inode change (the old pair is dead together), while the `<gitDir>/refs`
  half is *also* re-statted and repaired on its own on every call regardless of whether `<gitDir>`
  itself changed — so a `refs/` dir that didn't exist yet, or that was deleted (fully packed) and later
  reappeared, is picked up on the very next `ensureWatch` without needing `<gitDir>` to change at all.
  The whole pair is **reaped when the project record is gone**, keyed off the project id rather than any
  one workspace's id.
- **Public surface (barrel):** `ensureWatch`, `stopWatch`, `stopAllWatches`, `setWatchPublisher`,
  `setRepoMetaPublisher`.
- **Allowed deps:** `persistence` (workspace + project lookup); `contracts` (payload type); Bun/Node.
- **Forbidden:** `host`; sibling features; any pi package.
