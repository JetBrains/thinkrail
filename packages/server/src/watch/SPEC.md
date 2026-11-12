---
id: submodule-server-watch
type: submodule-design
status: active
title: watch — worktree change notifier
parent: module-server
depends-on: [module-contracts]
tags: [live-refresh, public-surface-checked]
---

## Responsibility

The filesystem change notifier behind the UI's live refresh: one recursive watcher per watched
workspace worktree (Bun's native `fs.watch(root, { recursive: true })` — no watcher dependency; on Linux
one per directory, see below),
coalescing events into a debounced **`workspace.fsChanged`** publish (`WorkspaceFsChangedPayload`:
`{ workspaceId, paths, truncated, skillChange }`). The frame is an **invalidation nudge, not data** — clients
re-read through the existing read methods (`fs.*` / `git.*` / `spec.graph`), so the reads stay the
single source of truth and a duplicate/replayed frame is harmless (one extra refetch, never wrong
state). Chosen over per-path client-side tree patching (would make the client a second source of
truth) and visible-panel polling (laggy, wasteful over Tailscale).

## Boundary

- **Owns:** the watcher registry + its lifecycle: `ensureWatch(workspaceId)` (idempotent and
  **self-healing**; returns the live watcher's shared readiness promise; started lazily by `host` when a
  workspace read or a `workspace.watchReady` preflight lands — the read is the "a client is looking"
  signal — and as a **prewarm** watch for the root a `search.query` resolved;
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
  Its readiness promise resolves only after that publish. The web's resource-loading flows (session create,
  resource reload; transcript reads send the preflight but do not wait on it) await the typed
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
  `workspace.watchReady`'s optional `prewarm` flag, the web's pre-selection warm-up, and by the search
  palette's root watch — starts the same
  watcher but marks its entry **prewarm-only**. Prewarm-only entries live in one global pool capped at
  **8**: creating one beyond the cap evicts the least-recently-prewarmed prewarm-only entry through
  `stopWatch` (its conservative readiness settle included), so clicking through many projects reuses one
  bounded pool instead of accumulating watchers for one host lifetime. Any **real** call promotes the
  entry out of the tier for good — a watcher activated by a real workspace read or skill-load preflight
  is never evicted — while a prewarm hit on a live prewarm-only entry only refreshes its eviction
  recency, and a prewarm can never demote a real watcher (including across an inode-change
  re-creation). Correctness under eviction rides the existing recovery paths: the next real call
  re-creates the watcher and its fresh conservative startup nudge covers the blind window.
- **On Linux each directory gets its own watcher, and ignored folders get none.** Bun's recursive watch
  there adds an inotify watch per directory, so a large git-ignored folder used up
  `fs.inotify.max_user_watches` and every start failed (#852); Bun keeps all watches on one inotify
  descriptor, so the limit is watches (`ENOSPC`), never descriptors (`EMFILE`). `node_modules` and nested
  `.git` get no watcher; of the root `.git` only the top level, `refs/`, `reftable/`, `info/` and
  `modules/` do, for the repo-metadata nudge — `modules/` minus any `objects`, `logs`, `lfs` or `hooks`
  folder, since a submodule's git dir can sit at any depth there. Root `.git` paths and paths inside a
  nested repo never go to the ignore check: an allowlist `.gitignore` reports `.git` itself, and git fails
  a whole batch on a path inside a submodule and answers for another nested repo with the outer rules. A
  `.gitignore` event or a repo-metadata nudge re-checks the folders skipped as ignored (`git add -f`, an
  `info/exclude` edit); new folders and re-checks share one queue per tree that runs one `ignoredPaths`
  call at a time, and the first walk holds that queue, so a re-check asked for mid-walk runs after the
  walk's own (possibly older) answer instead of being overwritten by it. A new folder is walked and all it holds is reported, since files written before its
  watch have no event. A symlinked root is followed, links inside it are not. Readiness waits for the
  first walk. Known limits: a change inside an ignored folder sends no event; a submodule with a path part
  `objects`, `logs`, `lfs` or `hooks` sends no nudge for its commits; an edit of the global excludes or a
  linked worktree's shared `info/exclude` waits for the next nudge; ignored folders inside a nested repo,
  and a folder that becomes ignored after it is watched, stay watched until the watcher restarts; a
  worktree with more non-ignored folders than `max_user_watches` still fails, and each later read retries
  the walk up to the limit, as the recursive watch did.
- **On Linux watchers close in the background and never share a path.** One queue closes 256 watchers per
  event-loop turn for all stopped trees, because closing a large tree in one loop blocked the host for
  seconds; a new watch that hits `ENOSPC` first closes up to 4 of those batches and retries. Bun shares
  one inotify watch per path ([[submodule-server-locales]]), and a path deleted or moved away and made
  again while an old watcher holds it gets a dead watch. So every open first closes the other watchers on
  its path, queued or live in an overlapping tree (a nested repo opened as its own workspace; roots are
  compared by real path), and re-opens the live ones after its own — on every open, since a folder below a
  moved-away parent gets no event of its own. A re-opened watcher has lost undelivered events, so its tree
  re-lists the folder and reports a truncated batch with the folder's own `skillChange` (`unknown` would
  read as a skill change; a skill folder still gives `detected`). Cost for 22.8k folders: about 50 MB RSS
  against 2-4 MB for one recursive watch and a 0.3-0.5 s walk in slices under 50 ms, about 1.5× that on
  top of an overlapping tree. Known limit: old and new watches coexist until the queue drains (about 10 s
  after switching eight such trees), so near the limit new trees grow only as fast as old ones close, and
  another program of the same user can hit `ENOSPC` meanwhile.
- **Repo-metadata nudge (second seam):** a git-metadata write is *metadata, not content*, so it never
  becomes an `fsChanged` path (the `.git` blackout stands — plumbing storms must not turn into frames). It
  instead arms a separately debounced (300ms), **pathless** `setRepoMetaPublisher(workspaceId)` nudge. This
  is the only signal for a change that leaves the working tree byte-identical: `git switch -c <new-branch>`
  writes nothing outside the git dir, and a `git commit` moves `HEAD` without touching a worktree file.
  It is **not** matched on an allow-list of specific paths (`.git/HEAD`, `.git/logs/HEAD`, …): the
  platform streams coalesce and report *a* representative path per burst, so which git-internal path
  surfaces is not reliable. It drops only a deny-list instead — transient `*.lock` files and
  directory-only notifications (a directory's own change event; the concrete file event accompanies it)
  — because git commands, `status` included, routinely create and remove `index.lock` (also a
  submodule's `.git/modules/<sub>/index.lock`): counting that would make the client's
  `git.status`/branch re-read produce the next nudge, a self-sustaining refresh loop (#1102). A real update
  still surfaces a non-lock path — git renames the lock onto its target or appends to a reflog. A wildcard
  event (null filename) nudges it too. Three sources feed the one nudge:
  - `.git`-prefixed events seen by the **worktree** watcher — covers a **repo root** workspace, whose
    `.git` directory lives inside the watched tree;
  - **non-recursive** watchers on the worktree's git dir and its `logs/` **when that dir lies outside the
    root** (a repo root's in-tree `.git` directory is already covered above, so it is never watched twice):
    for a *linked worktree* (every workspace this app creates) `.git` is a *file* (`gitdir: <path>`) pointing
    at `<repo>/.git/worktrees/<name>`, i.e. **outside the watched root**, so a commit made in that
    worktree's terminal would otherwise produce no signal at all. Resolved with plain fs (stat + parse the
    gitfile line), never by shelling out — this module has no `git` sibling edge (`git`'s `headBranchAt`
    mirrors the same gitfile parse for the same reason). The top level holds the per-worktree files that
    move (`HEAD`, `index`, `ORIG_HEAD`, `COMMIT_EDITMSG`). `logs/` is watched because, with locks dropped,
    an attached-branch `git update-ref HEAD …` leaves only `HEAD.lock` at the top level and an append to
    `logs/HEAD` (the branch ref itself is in the shared git dir). Neither is
    recursive: the per-worktree dir can hold submodule git dirs under `modules/` — `objects/` included —
    whose churn would bring back event storms. A missing `logs/` (reflogs disabled), a missing/unreadable
    git dir (non-git folder) or a failed start degrades silently.
  - non-recursive watches on a linked worktree's **remote-tracking refs** in the shared git dir (found
    through the gitdir's `commondir` file): a terminal `git push` writes only there, so the Remote status
    would otherwise stay stale (#1009). ThinkRail branches are created `--no-track`, so there is no upstream
    config to follow, yet a push still updates `refs/remotes/<remote>/<branch>` through the remote's fetch
    refspec; the watch therefore follows the checked-out branch name under **every** remote, never parsed
    config. Per remote it watches the deepest existing directory along `<remote>/<branch>` and matches only
    the next path component (a slashed branch's parent dirs may not exist before its first push). It also
    watches `packed-refs` in the shared dir and `refs/remotes` itself (or `refs`, until `remotes` exists)
    for a remote dir appearing or vanishing — `git pack-refs` deletes an emptied `refs/remotes/<remote>/`
    and the next push recreates it. Unlike the sources above these match exact names: the shared dir
    serves every worktree of the repo, so another branch's ref update must not nudge this one, and a ref
    update always ends in a rename onto the ref's own name. Whenever the nudge fires, the target set is
    re-derived and every one of these watches is closed and re-created, never diffed against the old set:
    `git pack-refs` and the next push can delete and recreate a remote dir within one debounce, under the
    same path and often (ext4) the same inode, so a kept watch would stay bound to the deleted dir. A
    terminal branch switch is itself a nudge, so it rebinds. Not recursive: `refs/` grows with the repo's
    branch count.

  `host` fans the nudge out to two convergences: `syncWorkspaceBranch` (a workspace's branch label follows
  its live checkout) **and** a pathless, skill-neutral `fsChanged` frame (`paths: []`,
  `truncated: false`, `skillChange: "none"`) so the clients' git-derived reads re-read — `git.status` and an
  open `uncommitted`-scope diff tab are relative to `HEAD`, and would otherwise keep reporting a committed
  change as uncommitted until the next file edit.
- **Timer-driven delivery is contained:** the coalescer flush, the startup nudge, and the repo-metadata nudge
  run from this module's own timers, so a subscriber throw is warn-logged and swallowed rather than becoming
  a fatal `uncaughtException` that takes down the host (an e2e reset deleting `workspaces.json` mid-nudge
  once did exactly that). Later events keep flowing. The watch-started nudge is the exception: it runs in
  the guarded registration region described below.
- **Composition seams:** never imports `host`, `agent` or `git` — `host` injects the publish callback,
  `agent`'s pure project-skill path classifier and `git`'s ignore check at wiring time (the publisher-tee
  pattern). A missing classifier degrades concrete events to `skillChange: "unknown"`, never false-clean.
- **Self-healing per read (out-of-band worktree churn is normal — e2e resets, `rm -rf` in a terminal):**
  every `ensureWatch` re-stats the root and **re-creates the watcher when the inode changed** (a
  deleted+recreated path leaves the old stream silently following a dead inode), **reaps zombie
  watchers** whose workspace record no longer exists (a resurrected path-based stream would keep
  publishing for a forgotten id), and **retries a failed start on the next read** (no sticky failure
  marker). A watcher that errors mid-flight (ENOSPC, root deleted) is warn-logged and dropped —
  panels fall back to read-on-demand until a later read re-creates it. No idle-stop (bounded by
  workspaces actually visited plus the capped prewarm tier).
- **Watch-started nudge (third seam):** the moment a watcher entry is created (real or prewarm), before any
  event can reach the repo-metadata nudge, `setWatchStartedPublisher(workspaceId)` fires once — the host
  uses it to take the worktree's HEAD baseline, so the first git-metadata event of a watcher is judged
  against a known sha instead of being spent on seeding. A re-created watcher (inode change, prewarm
  re-admission) fires it again; the consumer compares with its retained baseline, so a HEAD move made
  while unwatched still records activity, while an unchanged HEAD is a no-op. It runs inside the registration's guarded
  region, and a throw there — from it or from anything after `entries.set` — tears the fresh entry down
  (`stopWatch`) rather than leaving a registered watcher whose readiness never settles.
- **Public surface (barrel):** `ensureWatch`, `stopWatch`, `stopAllWatches`, `setWatchPublisher`,
  `setRepoMetaPublisher`, `setWatchStartedPublisher`, `setSkillPathClassifier`, `setIgnoredPathsResolver`.
- **Allowed deps:** `persistence` (workspace lookup), `log`; `contracts` (payload type); Bun/Node.
- **Forbidden:** `host`; sibling features; any pi package.
