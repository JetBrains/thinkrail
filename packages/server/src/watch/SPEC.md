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
- **On Linux each directory gets its own watcher, and ignored folders get none.** Bun's recursive watch
  there adds an inotify watch per directory, so a large git-ignored folder used up
  `fs.inotify.max_user_watches` and every start failed (#852). `node_modules` and nested `.git` get no
  watcher; of the root `.git` only the top level, `refs/`, `reftable/`, `info/` and `modules/` do, for the
  repo-metadata nudge. A commit inside a submodule writes only to its git dir under `modules/`, which can
  sit at any depth (the name can hold `/`, nested submodules nest again), so every folder there is watched
  except `objects`, `logs`, `lfs` and `hooks`. Two kinds of path never go to the ignore check. Root `.git`
  paths: an allowlist `.gitignore` (`*` plus `!` rules) reports `.git` itself. Paths inside a nested repo,
  also one whose `.git` appears after the walk: git fails the whole batch on a path inside a submodule and
  answers with the outer repo's rules for any other nested repo. A `.gitignore` event or a repo-metadata
  nudge re-checks the folders skipped as ignored (`git add -f` or an `info/exclude` edit changes the
  answer); a deleted one leaves that list, because a rule like `run-*` still matches a missing path. A
  re-check skips watched folders, since adding them would send the whole tree to git each time. New
  folders and re-checks share one queue that runs one `ignoredPaths` call at a time (the first walk's call
  per level can run at the same time), so a checkout that adds a thousand folders can't start a thousand
  `git check-ignore` runs. A new directory is walked and all it holds is reported, since files written
  before its watch have no event; there is no inode check, because a recreated folder can get the old
  inode back. A symlinked root is followed, links inside it are not. Readiness waits for the first walk,
  so an edit right after it can't land in a folder that is not watched yet. Cost: a 22.8k-folder tree
  takes about 50 MB RSS against 2-4 MB for one recursive watch, and its walk 0.3-0.5 s in slices under 50
  ms. Known limits: a change inside an ignored folder sends no event, a submodule whose name has a part
  `objects`, `logs`, `lfs` or `hooks` (like `libs/logs`) sends no nudge for its commits, an edit of the
  global excludes or a linked worktree's shared `info/exclude` waits for the next nudge, ignored folders
  inside a nested repo stay watched, a folder that becomes ignored after it is watched stays watched until
  the watcher restarts, and a worktree with more non-ignored folders than the limit still fails, each
  retry walking it again up to the limit.
- **On Linux a stopped tree closes its watchers over several turns.** One queue closes 256 per event-loop
  turn for all stopped trees, oldest first: closing them in one loop blocked the host for 3 s for eight
  22.8k-folder trees and for 23-25 s after a start failed at 524,288 watches. Bun shares one inotify watch
  per path ([[submodule-server-locales]]): a path that is deleted or moved away and made again while any
  old watcher still holds it gets a dead watch, and closing the old one later does not revive it. So a new
  watcher first closes every other watcher on its path, waiting in the queue or live in another tree (a
  nested repo opened as its own workspace), and re-opens the live ones after its own. It does this on
  every open, not only for a renamed path: a folder below a moved-away parent gets no event of its own and
  keeps following the old inode, so marking only renamed paths left both trees on a dead watch. Trees
  compare the real path of their root, resolved once at start, because Bun shares the watch of a real
  folder also across a symlinked spelling; the published paths stay relative to the root. A re-opened
  watcher loses the events Bun had not delivered yet, so its tree reports the folder as missed, and the
  workspace gets a truncated batch with the folder's `skillChange`: an open file tab re-reads only for its
  own path, a truncated batch or a batch with no paths, and `unknown` would look like a skill change to
  the web. A re-opened skill folder still gives `detected`, so after an overlapping start the nested
  workspace's chats show the skills badge though usually nothing changed: a `SKILL.md` write lost in the
  hand-off must still refresh skills. The tree also lists the folder again and walks the subfolders it
  doesn't know, because a lost folder event would leave a new folder unwatched for good. A tree that
  starts on top of a live overlapping one thus closes each shared folder's watcher and opens it twice (its
  own open and the re-open): a 22.8k-folder nested repo was ready after 1.40-1.54 s against 0.98-1.03 s
  alone, with twice the watch calls and +98-109 MB RSS against +68-74 MB at ready. A new watch that hits
  `ENOSPC` closes up to 4 batches of waiting watchers and retries, so a new tree doesn't fail only because
  an old one is still closing. Then it gives up: watchers of deleted folders free no slot, and closing all
  of them in one call blocked about 1 s for four 22.8k-folder trees. Known limit: old and new watches are
  open together until the queue drains, about 10 s after a switch of eight 22.8k-folder trees (up to 320k
  watches against 182k, about 900 MB RSS against 520 MB), so another program of the same user near the
  limit can hit `ENOSPC` then. Near the limit the new trees also grow only as fast as the old ones close:
  at a 210,000 limit all eight were ready after about 9-10 s, against about 4 s with a high limit.
- **Repo-metadata nudge (second seam):** a git-metadata write is *metadata, not content*, so it never
  becomes an `fsChanged` path (the `.git` blackout stands — plumbing storms must not turn into frames). It
  instead arms a separately debounced (300ms), **pathless** `setRepoMetaPublisher(workspaceId)` nudge. This
  is the only signal for a change that leaves the working tree byte-identical: `git switch -c <new-branch>`
  writes nothing outside the git dir, and a `git commit` moves `HEAD` without touching a worktree file.
  It is deliberately **not** matched on specific paths (`.git/HEAD`, `.git/logs/HEAD`, …): the platform
  streams coalesce and report *a* representative path per burst, so which git-internal path surfaces is not
  reliable. A wildcard event (null filename) nudges it too. Two sources feed the one nudge:
  - `.git`-prefixed events seen by the **worktree** watcher — covers a **repo root** workspace, whose
    `.git` directory lives inside the watched tree;
  - a second, **non-recursive** watcher on the worktree's git dir **when that dir lies outside the root**
    (a repo root's in-tree `.git` directory is already covered above, so it is never watched twice): for a
    *linked worktree* (every workspace this app creates) `.git` is a *file* (`gitdir: <path>`) pointing at
    `<repo>/.git/worktrees/<name>`, i.e. **outside the watched root**, so a commit made in that worktree's
    terminal would otherwise produce no signal at all. Resolved with plain fs (stat + parse the gitfile
    line), never by shelling out — this module has no `git` sibling edge. Non-recursive because only the
    dir's top level holds the refs that move (`HEAD`, `index`, `ORIG_HEAD`) while `objects/`/`logs/` are
    pure storms, so a commit inside a linked worktree's submodule (its git dir is under `<gitdir>/modules/`)
    sends no nudge; a missing/unreadable git dir (non-git folder) or a failed start degrades silently.

  `host` fans the nudge out to two convergences: `refreshUserOwnedWorkspace` (a user-owned workspace's
  folder-truth branch labels) **and** a pathless, skill-neutral `fsChanged` frame (`paths: []`,
  `truncated: false`, `skillChange: "none"`) so the clients' git-derived reads re-read — `git.status` and an
  open `uncommitted`-scope diff tab are relative to `HEAD`, and would otherwise keep reporting a committed
  change as uncommitted until the next file edit. Known limit: a populated submodule makes the nudge feed
  itself while a client reads git status, because `git diff HEAD` runs `git status` inside the submodule,
  which takes `index.lock` in its git dir; on Linux that is about one nudge every 320 ms, and the macOS
  recursive watcher does the same.
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
