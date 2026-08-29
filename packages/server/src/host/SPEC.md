---
id: submodule-server-host
type: submodule-design
status: active
title: host — the browser↔host wire
parent: module-server
depends-on: [module-contracts]
tags: [v1, host]
---

## Responsibility

The wire and composition root: `Bun.serve` HTTP+WS, static SPA serving, the WS method→handler registry,
channel fan-out, and the process-boot wrapper both launchers share.

## Boundary

- **Owns:** `server.ts` (async `createServer` first asks auth to start Central artifact watching and publish
  the initial current PI runtime, falling back to plain PI with closed `load-failed` state when needed, then creates
  `Bun.serve` with `/health`, `/ws` upgrade, a
  **`GET /files/<workspaceId>/<relpath>`** route streaming a worktree file's raw bytes (via `fs`'s
  `resolveWorktreeFile` — path-contained; bad id/escape/miss → 404; Bun infers the content-type) so the
  markdown viewer's relative `<img>`s resolve, static serving with
  `index.html` fallback, the `server.welcome` push, the **`?client=` page identity** read off the socket URL at
  upgrade (threaded to every handler as `RequestContext`; it addresses terminal output but no longer *owns*
  PTYs — see [[submodule-server-terminal]]) plus the `clientKey → socket` registry and the **replay-namespace
  retention timer** that outlives a reconnect (terminals are deliberately untouched by it); the
  **request replay cache** keyed by `(clientKey, requestId)` (the first frame
  owns one handler promise + its
  serialized response, a reconnect replay awaits/returns that same result, a mismatched duplicate is rejected,
  and reaping the client clears its cache — but **only once nothing is in flight**: an unresolved request
  outlives the socket grace window, since the page holds that frame until its *own* deadline (30 minutes for
  the folder picker) and replays it on reconnect, so `clearClient` declines and the reap re-arms rather than
  let the replay start a second execution of a handler that has not finished). **Nothing in that cache is ever evicted**, because a
  successful `send` says the bytes were queued, not that the page read them, and a socket that dies holding a
  reply is indistinguishable from one that flushed it — so any result dropped on the host's own initiative may
  be the one a replay is about to ask for. A result leaves only on the client's own word, via two frames handled
  here and never routed to a handler: `{ ack: [id] }` names responses it has **read** (the steady state), and
  `{ resume: [id] }` on each reconnect names everything it still considers **unresolved**, freeing all other
  settled results. `resume` is what makes receipts safe to lose — an ack can die in a socket buffer exactly like
  a response can, and nothing would ever re-send it, so each reconnect restates the whole truth instead of
  confirming the confirmations. Cost is bounded instead by **two hard limits, each enforced where its size becomes
  known**: the entry count on the way *in* — a full namespace refuses new ids (`RequestReplayOverflowError` → a
  normal `ok: false`) while still answering every id it holds — and the retained bytes on the way *out* of the
  handler, since a response's size is unknowable at admission (`fs.readFile` returns a whole file) and in-flight
  work weighs nothing, so an admission-time byte check would bound the count and nothing else. A result that
  would breach the byte budget is not retained: the entry stays as proof the work ran, so its replay fails
  (`RequestReplayUnretainedError`) rather than re-executing, and the response the caller was already sent is
  unaffected. Neither limit can cost exactly-once — one refuses work that has not started, the other keeps the
  record of work that finished and drops only its answer,
  the **`provider.login`** channel publish (the `auth` module's session-less login-frame bridge, wired like
  `pi.extensionUi`), the **`provider.changed`** invalidation broadcast after auth changes the Central status or
  current runtime generation (clients re-read status/models), and the `provider.*` login handlers, the
  **`watch` wiring** (inject the
  `workspace.fsChanged` publish callback into `watch` and inject `agent`'s project-skill path classifier so
  each capped batch carries independent `skillChange: none|detected|unknown` evidence; expose
  **`workspace.watchReady`** as the typed preflight that awaits a fresh watcher's conservative startup nudge
  before a web skill-loading flow
  captures its baseline and reports whether the watcher was already known ready (the client's replay-safe
  conservative fallback; its optional `prewarm` flag is forwarded into `watch`'s bounded prewarm-only tier,
  so pre-selection warm-ups never grow the watcher registry unboundedly); plus the **repo-metadata** callback (`setRepoMetaPublisher`) fanned out to **two**
  convergences for a git-metadata write in a watched worktree:
  `refreshUserOwnedWorkspace` (**re-sync a user-owned workspace's folder-truth branch** — host-mediated,
  since `watch` has no `workspaces` edge, and self-publishing through the workspace-lifecycle tee) **and** a
  pathless, skill-neutral `fsChanged` frame (`paths: []`, `truncated: false`, `skillChange: "none"`) so the
  clients' `HEAD`-relative reads
  (`git.status`, an `uncommitted`-scope diff tab) re-read when a terminal `commit`/`reset` moves a ref;
  the same publish also feeds the **fsNudge seam** (`fsNudge.ts`: `setFsNudgePublisher` +
  `nudgeBaseRefWorkspaces`), the host mediation the `git.prefetch` handler triggers when the app's own
  background fetch **moved** a remote-tracking ref — a write only the project repo's shared `.git` sees,
  invisible to every worktree watcher — fanning the pathless frame to each workspace of that project whose
  diff base is the moved ref (their branch-scope merge-base may have moved — the re-read is idempotent when
  it hasn't; everyone else stays asleep)
  without touching a worktree file; call
  `ensureWatch(workspaceId)` from the
  workspace-read handlers (`fs.*`, `git.status`/`git.diffFile`, `spec.graph`) — a read is the "a client is
  looking" signal; `stopWatch` in `workspace.remove`'s fast path beside `evictSpecIndex`;
  `stopAllWatches()` in `stop()`), `stopJbcentralRuntime()` and `cancelAllLogins()` in `stop()` before the
  socket close,
  an optional boot-time `openProject(projectPath)` (best-effort — a launcher convenience), the
  **analytics wiring** (`initializeAnalytics` at boot from the launcher-threaded `analytics` option —
  keys/channel/mute + the initial `getConfig().analyticsEnabled`; a `setAnalyticsSending` sync teed
  off the settings publisher; a fire-and-forget `shutdownAnalytics()` in `stop()` — best-effort queue
  drain; and every `track()` call site: `chat_started` in `session.create`, `message_sent` (via the
  local `trackSend(mode, text)`) after an **accepted** `session.prompt`/`session.steer`/`session.followUp`
  (`prompt`/`steer`/`follow_up`; skipped when contracts' `isControlMessage(text)` — the client's TODO
  wake-nudge rides the same methods and is not a user message; `session.answerQuestion` is a tool reply,
  not a message either),
  `provider_login` from the
  login-publisher tee's terminal `success` frames with the method (`oauth`/`api-key`) looked up from
  `loginAnalytics.ts` — the loginId→method map the `provider.loginStart` handler records (and
  `provider.loginCancel` clears; an unknown loginId tracks nothing, fails closed) — +
  a successful `provider.jbcentralConnect`→`applied` (failed actions never count) — per
  `submodule-server-analytics`,
  feature modules never track), and
  `stop()` → immediate agent-session cleanup, then `persistTerminalSessions()` **before**
  `closeAllTerminals()`, then watcher/socket disposal; `shutdown()` memoizes one asynchronous graceful
  path: bounded `settleSessionsForShutdown()` + awaited `shutdownAnalytics()` first, then `stop()` and
  ownership-lease close). The bounded settle includes hidden delegation children even when their parent is
  idle, plus child cascades already started by a concurrent removal, so graceful quit does not let a
  background child lose its terminal abort/tool result; `crashLog.ts` (`installCrashLog` — the `uncaughtException`/`unhandledRejection` report
  appended to `<dataDir>/logs/crash.log` and echoed to stderr, then `exit(1)`: in-process pi means such a
  fault is the whole host's, and a launcher started without a terminal otherwise loses its only trace.
  Never a recovery, and never installed under `NODE_ENV=test` — a unit-test process reports its own
  faults. It renders the throw via the `log` module's `describeError`, so crash reports and log lines
  agree, but keeps its own sync append — the death path must not depend on the logger's state);
  `ownership.ts` (canonicalize the data directory, hash its fingerprint into a dedicated deterministic
  loopback candidate range, hold an exclusive `node:net` listener, and answer a bounded versioned
  fingerprint handshake; same-owner candidates refuse, different owners advance, and an occupied
  unresponsive candidate fails closed); `boot.ts` (`bootHost` → acquire ownership before any mutable host
  initialization, await `initLogging` — debug level when the launcher passed `verbose` — then install the
  crash report, resolve the login-shell PATH, pre-warm the same
  Central watcher/runtime initialization before choosing the serving port, await `createServer` (which
  idempotently enforces runtime bootstrap for low-level embedders), attach the lease to
  `RunningServer.shutdown()`, and write the `listening on` info line (see `submodule-server-log`). Its
  SIGINT/SIGTERM handlers await that same shutdown before process exit. Settling aborts streaming sessions
  and waits bounded so pi persists their "Operation aborted" tool results and transcripts land paired; an
  immediate exit would strand mid-tool transcripts on restart repair); `handlers.ts` (the WS method→handler registry, including the **Skills-manager set**:
  `skill.list` / `skills.state` / `project.skills` build the admission context from `projects` (+ the
  workspace's `skillOverrides` when workspace-scoped) and pass it into agent's `listSkillCommands`/
  `listSkillCatalog`; `session.list` decorates agent's `listSessions` summaries with
  `openTodos: countOpenTodos(…)` per session (a host-only composition of `agent` + `todos` — `agent`
  stays todos-free; a failed count omits the field, never fails the list); **`todo.requestFix`** is the
  same kind of composition (`todos` records + renders the fix package, `agent` delivers): the package is
  fired **detached** into the item's own chat via `followUpSession` (`fireTodoFixPrompt`, the
  `fireReviewPrompt` pattern) — a pre-turn rejection rolls the review record back (`rollbackTodoFix`) and
  surfaces as an extension-UI notice, so an undelivered fix request never strands as `changes_requested`.
  The manual fix package **carries the item's open agent findings** exactly like the automated cycle
  does (`itemFixFindings` — this item's unstale agent-authored drafts by `origin`, `markCommentsSent` +
  `buildSendPackage` under `withReviewLock`): with auto-fix off, the verdict path sends nothing, so
  without this the worker never sees the reviewer's findings and they strand as drafts under a later
  approve. The same pre-turn rejection also `rollbackSend`s them back to draft;
  **`todo.remove`** layers a host-side guard in front of `todos`' own, together covering the item's
  full in-flight lifetime — neither alone does: `removeTodo`'s durable `pending` mark covers
  `startTodoReview` (synchronous, before `currentReview` registers post-session-creation) through
  `review_verdict`, which clears it MID-turn; `isItemUnderActiveReview(sessionId, id)` reads
  `currentReview` (set once the reviewer session exists, live until `handleReviewerSettled`) and covers
  the tail `pending` misses — the reviewer's tool seams stay usable after the verdict, until the turn
  actually settles. `handlers.ts`'s `todo.remove` checks `isItemUnderActiveReview` before ever calling
  `removeTodo`, whose own `pending` check remains the front-edge guard. A `session.dispose` on a still-
  streaming reviewer chat aborts it first (mirroring `deleteSession`/`removeWorkspaceSessions`) so the
  resulting settle event still reaches `handleReviewerSettled` before the session unsubscribes — without
  that, a closed tab would leak its `currentReview` entry for the process's life, wedging `todo.remove`
  on an item no review will ever finish;
  **`todo.startReview` + `host/todoReview.ts`** compose the agent reviewer: **one review in flight
  per plan** — an in-memory latch (`inFlightReview`, set SYNCHRONOUSLY at start entry, so two starts
  can't interleave across awaits) held **until the reviewer SETTLES, not until the verdict**: the
  verdict clears the persisted `pending` flag mid-turn while the reviewer is still streaming, so a
  pending-based guard would reopen exactly the clobber window it exists to close (`currentReview`
  overwritten mid-turn → the first review's findings stamped with the second's origin). A manual
  start against a held latch is rejected loudly (the client also disables the per-row Start review
  buttons while anything is reviewing); the AUTO re-review defers silently instead of throwing and
  is RETRIED on the reviewer's settle (see below) — a thrown auto start would strand the
  changes_requested item forever, and a queue advance whose every `startOne` throws the same guard
  error would drain and delete the whole Review All pass. The latch clears on: start failure, a
  rejected detached send, stuck-flag cleanup, and the reviewer's settled turn. Then ensure/pin the plan's
  reviewer chat, fire the review package detached through the injected `SendReviewPackage` (`followUpSession` in production; a pre-turn rejection clears the `reviewing` mark and the session's `currentReview` registration, unit-tested by injecting a rejecting sender), install the
  `add_review_comment`/`review_verdict` tool seams (reviewer session → workspace → worker plan via
  `getSessionWorkspaceId` + `workerSessionForReviewer`; non-reviewer callers get a loud error).
  **`review_verdict` never trusts the model-supplied `todoId`:** the verdict must name the session's
  `currentReview` item exactly, else it is rejected loudly (the reviewer re-issues) — a mistyped or
  stale id would otherwise approve/flag ANOTHER step while the real item stays pending and the queue
  never sees its verdict. The recorded ref and the queue settlement both derive from the registered
  `currentReview`, not the params. The auto-fix candidates are the ORIGIN-SCOPED `itemFixFindings`
  (this item, this worker session, non-stale) — an unscoped draft sweep would carry other steps'
  findings into this worker and strand them as falsely-sent. **`approve` is rejected while
  `itemOpenFindings` is non-empty** — checked before `approveTodoReview`, so no verdict can record an
  item reviewed out from under a finding the Review panel still shows as open: that would let the plan
  read ready-to-ship / enable Open PR with a blocking comment nobody resolved. The gate is deliberately
  a WIDER set than the fix-candidate filter: `itemFixFindings` is `draft`-only (a `sent` finding must
  not ride a second fix request), while the review model counts **both `draft` and `sent`** as
  unresolved — only `resolve_comment`/dismiss closes one. Gating on the draft-only set would leave the
  automatic re-review free to approve over a finding already delivered to the worker whose code fix
  landed without a `resolve_comment`. A **refuted**
  finding is excluded from the gate: an independent reflector judged it not real and `sendReflectedFix`
  deliberately holds it back, so nothing in the automated path would ever clear it — gating on it would
  wedge the item's approval rather than protect it. **`resolve_comment` is the WORKER'S tool, not the
  reviewer's**: `reviews.applyAgentResolution` only resolves a `sent` comment, and only when the calling
  session equals `comment.sessionId` — the chat `markCommentsSent` recorded, i.e. whoever it was
  actually delivered to (`agent/reviewTool.ts`'s handler threads `ctx.sessionManager.getSessionId()`
  through; a draft finding, sent-or-not, is unconditionally unresolvable, closing the loophole where a
  reviewer could `add_review_comment` then immediately `resolve_comment` its own still-`draft` finding
  and sail through the gate it exists to enforce). The reviewer's own way past the gate is therefore
  never `resolve_comment` — it is the worker actually fixing and resolving a `sent` finding (which the
  send package's own instructions already ask for), staleness (the reviewed lines got overwritten,
  `isFindingStale` excludes it), reflection refuting it on a `request_changes` round, or `request_changes`
  itself.
  `add_review_comment` first runs the deterministic positioning gate (`reviews.anchorProblem`): a finding
  citing a path absent from the worktree or a line past EOF is rejected fail-fast (the reviewer re-files)
  rather than stored as a dud anchor — reanchor can't catch this, since a finding's textQuote is captured
  from whatever the cited lines held at add time. **`reflect_finding` is scoped to the pending
  reflection**: the calling session must own a `pendingFix` entry and the comment id must be one of
  its captured candidates — any workspace session could otherwise stamp kept/refuted onto an
  unrelated (or human) comment. It then runs the
  ONE auto fix cycle (reviewer comments → `buildSendPackage` → the worker chat) and the one auto
  re-review off the reconcile tee (`maybeAutoReReview`); **`todo.reviewAll` + `host/reviewQueue.ts`**
  add the Review All pass (task-plan-review-kebab): `startReviewAllFlow` seeds a per-(workspace, session)
  in-memory FIFO with every *unsettled* reviewable item (plan order) and kicks the first. Advancement is
  TWO-PHASE: a reviewer verdict for the in-flight item (`onReviewVerdict`, all three `review_verdict`
  branches — approve OR changes_requested, so a requested item's background fix + auto-re-review never
  stalls the pass) only CLEARS the in-flight slot; the NEXT item starts on the reviewer session's
  **settled turn** — `handleReviewerSettled`, the ONE session-publisher settle hook, in strict
  order with NO early exit for a registered reviewer: stuck-flag cleanup (+ queue advance past
  dead items) → registration drop + latch release → queue advance → auto-re-review retry when nothing started (gated
  by the monitor's reviewer registry, no disk lookup for non-reviewers). The queue advance runs
  even after a cleanup (a cleared stale flag that isn't the queue's in-flight item must not stall
  the pass), but the **auto-re-review retry runs only off a HEALTHY settle**: a crash settle that
  retried would let a deterministically failing reviewer (context overflow, provider outage)
  restart itself forever — no verdict ever advances `autoCycles`, so nothing breaks the loop, and
  an exclusion of just the crashed item would still ping-pong between two eligible items. A
  deferred re-review instead resumes on the next healthy reviewer settle or worker reconcile;
  after a crash the human decides (which is what the crash notice tells them). And the **latch is released only by
  the session that OWNS the in-flight item** (`currentReview[settled] === latch value`) — a stale
  reviewer chat settling later (superseded pin, user typing in an old reviewer) must not unlock a
  review that is still streaming elsewhere; a superseded pin's registration is also cleared at
  re-pin. The **`currentReview` registration itself is dropped on EVERY settle** (healthy or
  cleanup), owner or not — a registration that outlived its settled turn would let a later user
  turn in that reviewer chat file comments or a `review_verdict` against the already-settled item
  with stale provenance, including re-triggering an auto-fix cycle after an approval. Never
  mid-turn, so the next package can't re-stamp `currentReview`'s origin while the
  previous turn is still filing comments (the provenance clobber). A pre-turn send rejection advances explicitly (`onReviewStartFailed` in
  `fireReviewerPrompt`'s rejection path — an undelivered package must not strand the pass, since no
  verdict or settle will ever come for it), and so does a reviewer that settles with stuck `pending`
  flags (crash, abort, or a turn that never called review_verdict): `maybeCleanupCrashedReviewSession`
  routes every cleared item through the same seam, or `queue.current` would stay occupied and every
  later Review All would answer `alreadyRunning` forever (see reviewerSessionMonitor.SPEC.md). **Starting a
  pass while one is active is refused** (`{ total: 0, alreadyRunning: true }` on the wire): a second
  Review All press must not orphan the in-flight review or run two packages in one reviewer chat. The
  claim is synchronous — `claimReviewQueue` reserves the slot BEFORE `startReviewAllFlow`'s first await
  (`listTodos`), so two concurrent presses can't both read "not active" and race past the guard; the
  loser gets `alreadyRunning` immediately instead of clobbering the winner's queue once its plan load
  resolves. The reservation is always resolved on every exit path — `seedReviewQueue` with the real ids
  on success, or with `[]` in a `catch` on failure — so a thrown `listTodos` can never leave a stuck
  placeholder blocking every later Review All. The placeholder's `current` is a private `CLAIMING`
  sentinel, never `null`: the plan's reviewer chat is pinned and reused across passes (`startTodoReviewFlow`),
  so its *next* settle can land while a fresh claim's `listTodos` is still pending — with `current: null`
  that stale settle would read the placeholder as idle and delete it via `onReviewerSettled` before it
  was ever seeded, reopening the exact race the claim exists to close. `reviewQueue.ts`
  is pure mechanics with an injected `startOne` (no agent/session dep — unit-tested in
  `reviewQueue.test.ts`, including the concurrent-claim race and the stale-settle-during-claim race).
  **The manual and batch entry points are mutually exclusive too, both directions, both claimed
  synchronously before their own first await:** `startTodoReviewFlow` (manual) rejects when
  `reviewQueueActive` is already true unless it is the queue's OWN advance calling it
  (`opts.fromQueue`, set only by `startOneReview`'s closure — every real invocation of that closure
  comes from queue mechanics that already checked queue membership, so it is always legitimate) —
  without this, a manual start landing in Review All's claim→`listTodos` gap would set `inFlightReview`
  first, and every queued item Review All then tries would hit that latch and get silently skipped
  while the wire still reports the original `total`. `startReviewAllFlow` symmetrically checks
  `inFlightReview` before ever calling `claimReviewQueue` — a manual review already running reports
  `alreadyRunning` immediately instead of claiming the queue and discarding the whole batch the same
  way;
  `project.setTrust`
  acknowledges the aliases present at grant via agent's
  `listProjectAliasSkillNames`; `project.acknowledgeSkills` / `project.setSkillEnabled` /
  `project.setGroupEnabled` / `project.aliasSkills` / `workspace.setSkillOverride` mutate/read the persisted
  toggles; `session.reloadResources` re-scans a running session — the composition stays here; `agent` never
  imports its sibling. `createServer` also wires **`setSkillAdmissionResolver`**, mapping a session's
  `workspaceId` → its project's trust/acknowledged/disabled + that workspace's overrides (fail-closed), so
  `agent` gates skills without importing `projects`/`workspaces`);
  **`reviewerSessionMonitor.ts`** (safety for stuck reviewer sessions) — when a reviewer session crashes/times out
  without sending a verdict, the item's `pending` review flag (the UI's `reviewing: true` spinner) previously
  persisted forever, deadlocking the Review All queue. The monitor subscribes to session settled events
  (tee'd off `setSessionPublisher`), detects crashes (terminal errors, unexpected stop reasons), and
  immediately clears `pending[id]` for any item the crashed session was reviewing. This unblocks the UI
  and allows Review All to continue. The mechanism tracks reviewer→worker session mappings (registered
  once per `startTodoReviewFlow`, cleared on crash detection); see `reviewerSessionMonitor` module and
  the session-publisher tee in `server.ts`. **This net is itself memory-only** — a host *process*
  restart (not just one reviewer session settling) wipes the mappings, `currentReview`, and the review
  queue right along with it, while `pending` marks are a disk sidecar that survives. `createServer` calls
  **`reconcilePendingReviewsOnBoot`** once, before the server accepts connections: it walks every project's
  every workspace and calls `todos`' `clearAllPendingReviews(worktreePath)`, which sweeps every session's
  sidecar and drops every `pending` entry unconditionally — safe because nothing has registered a mapping
  in this fresh process yet, so every mark found necessarily predates it. Without this, a review in flight
  at the last shutdown would spin forever (no mapping left to clear it), Review All would skip it forever
  (its own `reviewing !== true` filter), and its old reviewer chat, if reopened, would get a
  correct-but-unhelpful "no review is in flight" from `review_verdict` with no way out except this sweep;
  `ackSend.ts` (the send-ack policy — see "Get right"); `autoRename.ts` (the **workspace auto-rename
  flow** — the composition of `agent` + `assist` + `workspaces` only the host may make, in **two passes**
  the session-publisher closure in `createServer` tees fire-and-forget, both triggering a
  `renameWorkspace` (which **self-emits `workspace.updated`** through the lifecycle publisher — the tee no
  longer pushes) and both reading the session **transcript** via `getSessionMessages` (never `agent_end.messages` — that
  array is run-local and empty of the prompt on auto-retry continuations) then `extractFirstTurn` (assist
  skips killed error/aborted turns, so a retracted prompt never becomes the name); an injectable
  transcript reader is the unit-test seam:
  - **Naive (instant):** `maybeNaiveNameWorkspace(sessionId, workspaceId)` when the **first prompt lands**
    (`isPromptCommitted(event)`, exported: a **user `message_end`** — `agent_start`/`turn_start` fire
    *before* the prompt's `message_end`, so the transcript wouldn't yet hold the prompt at those; this
    still fires before the model responds, so the name is instant and no tool/question can block it). It
    derives a **display name** from the first prompt with assist's non-agentic `naiveWorkspaceName` (no
    model call) and renames **provisionally** (`renameWorkspace(..., { lock: false })` — name + derived
    branch move but `renamed` stays unset). It fires only on a **pristine** workspace (`!renamed` AND its
    **branch** still `workspace-N` — gated on the branch, not the display name, so the two stay decoupled),
    so it lands once and never overwrites a user/agentic name; a per-workspace `naiveInFlight`
    set dedupes re-fired prompt-commits. This is why a long first turn no longer leaves the workspace as
    `workspace-N` for minutes.
  - **Agentic (refine):** `maybeAutoRenameWorkspace(sessionId, workspaceId)` on every **settled** turn
    (`isSettledTurn(event)`, exported: `agent_settled` — never `agent_end`, which is attempt-level and can
    precede compaction/retry even when `willRetry` is false). It asks assist for a
    human-readable name (cheap model), re-checks the workspace (exists, not `renamed`) after the await,
    then calls `renameWorkspace` in the same tick — upgrading the provisional naive name into the final
    name (and its derived branch) and **locking** it (`renamed: true`). Best-effort by contract: every failure path resolves `null` and
    leaves the flag unset so a later settled turn retries — but a swallowed exception is warn-logged
    (a broken rename path must stay distinguishable from "assist had nothing"). Its own per-workspace
    **in-flight set** (independent of the naive one — the two passes can overlap on a short turn) dedupes
    concurrent turns/sessions.
  - The **workspace-archive teardown** — the other composition of `agent` + `terminal` + `workspaces` only
    the host may make. `workspace.remove` **rejects a `kind: "default"` workspace loudly, before any
    side-effect** (the record's `worktreePath` is the project folder — the reclaim's `rm -rf` fallback
    must never see it; the UI hides Remove, this guard is for buggy/rogue clients). Otherwise it
    reaps *everything* rooted in the worktree (for a user-owned `kind: "external"` one, everything except
    the checkout itself) but is **non-blocking**:
    it does the fast part synchronously — `forgetWorkspace` (drop the record → gone from `workspace.list`
    immediately) → `evictSpecIndex` (drop the spec cache) → `closeWorkspaceTerminals` (kill its PTYs) —
    **acks**, then runs the slow reclamation in the **background** (`archiveTeardown`, fire-and-forget):
    `removeWorkspaceSessions` (abort a streaming turn, dispose the live sessions, **and** purge pi's
    on-disk transcripts for the cwd) → `reclaimWorktree` (`git worktree remove`; a hard no-op for an
    external one). So the user never waits
    for the git subprocess + session abort. **Ordering holds:** terminals (sync) and sessions (bg, before
    the reclaim) are down before the dir is deleted, since they hold it as cwd, and the workspace's
    todo-mutation queue is settled (`settleChangeArtifacts`) between the two — an in-flight reconcile's
    plan/baseline writes land before the reclaim that sweeps them, never after it into a resurrected dir. Best-effort by contract —
    a failed background teardown is warn-logged, never thrown into the void (nothing awaits it), like
    the auto-rename tee. **Archive keeps the branch but not the chat:** the git branch stays (code is
    recoverable), yet chat history is purged with the worktree — a deliberate scope choice, not a leak.
- **Review state is host-composed and serialized per workspace** (`reviewLock.ts`): `review.send*` is
  `reviews` (drafts + package) plus `agent` (session) plus `reviews` again (mark sent + link) — a
  check-then-mark straddling an `await createSession(…)`, the review layer's only non-atomic gap.
  **`withReviewLock` covers every review mutation the WIRE exposes, not just sends**, because two different things fall
  into that gap: a second *send* reads the same "drafts, no session yet" and forks the review, and a
  *mutation* invalidates the package already built — a `review.close` Clear landing there strands the
  package: the mark sees a fresh empty review and links the chat to *that*, leaving comment ids
  the agent can never `resolve_comment`. One queue per workspace, so a mutation issued mid-send simply
  happens after it.
  The package prompt is fired **detached** after the mark, so the lock only ever holds session
  creation, and a failed operation releases it rather than poisoning the queue. Deliberately unlocked:
  `review.get` (its load → re-anchor → persist is one synchronous pass, and hydration must not queue
  behind a send) — plus the two mutations that don't
  arrive over the wire, `reviews.resolveCommentFromAgent` (the agent-tool seam) and `reanchorWorkspace`
  (the fs-watch tee): both are fully synchronous and re-read the snapshot from disk before writing, and
  neither removes a comment nor closes the review, so landing in a send's gap can't invalidate the
  package's ids.
- **A review send lands in the conversation already on screen, else the key's chat.** Both send
  handlers route through `sendToFileChat`: comments are grouped by `reviews.reviewSessionKey` (the
  anchor's path, or the review-level bucket for anchorless remarks — pinned like a file so a second
  overall remark continues one discussion), and each group lands, in order of preference, in the
  client's **last open chat** (the optional `sessionId` the send carries — the conversation the user
  is already in), else the key's pinned chat (`reviews.fileReviewSession`), else a NEW chat; whatever
  received the package becomes the key's pin (`markCommentsSent`), so the sidebar's "open the
  discussion" always follows the comments. **`review.sendBatch` answers with every session it touched**, in group
  order: a batch spanning two files starts two chats, and naming only the first left the other one
  running unseen while its comments already read as sent (the client opens them all, focusing the
  first). A linked chat that is merely **detached** is
  treated as present: it is `agent.ensureSessionAttached`ed from the persisted transcript and followed
  up into. Review state and pi sessions both survive a host restart, so gating on liveness alone
  (`hasSession`) meant any review chat no client had reopened got a *second* chat and an overwritten
  link. A new session is created only when the file never had one — or, logged as an explicit
  recovery, when the transcript is genuinely gone from disk (there is no UI to close a review and
  start over, so wedging it would be worse); every other re-open failure throws rather than silently
  forking the conversation.
- **Scratch-dir seeding on chat start:** the `session.create` handler calls `workspaces`'
  `ensureWorkspaceScratchDir` before creating the session — the Default workspace's gitignored
  `.thinkrail/context/` lands in the user's repo only when a chat actually starts there (and a
  worktree's deleted scratch dir self-heals). Host-composed — no new module edges.
- **Project lifecycle fan-out:** `createServer` installs the `projects` module's publisher and maps every
  authoritative open/reopen/close snapshot to **`project.updated`**. The WS `open` handler subscribes to
  that channel and hydrates two views in `server.welcome`: `projects` (open records only) and
  `recentProjects` (all known records). The one full-snapshot channel is idempotent and avoids separate
  opened/closed streams replaying out of order. Every client converges its rail + Recents from it; only
  the initiating open flow selects Project Home, while a close fallback remains per-client view state.
- **Workspace lifecycle fan-out:** `createServer` installs the `workspaces` module's publisher
  (`setWorkspacePublisher`), mapping each domain event `kind` → its `WS_CHANNELS.workspace*` channel
  (`created`/`updated` → the full record; `removed` → `{ projectId, id }`) and `server.publish`ing it. This
  is the **single** place workspace membership changes reach the wire — create/rename/archive all flow
  through it, so every client (including the initiator) converges by reacting, never by per-client optimism.
  The two new channels are `ws.subscribe`d in the WS `open` handler alongside `workspace.updated`.
- **Session-deletion fan-out:** `createServer` installs the agent module's deletion publisher and
  broadcasts each workspace-scoped `SessionDeletedPayload` on `session.deleted`; the WS `open` handler
  subscribes every client so permanent domain deletion converges beyond the initiating page. It remains a
  low-latency event, not a durable queue: a reconnecting client's active-workspace `session.list` is the
  authoritative read-side repair for an event missed while its socket was down.
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer` (including
  idempotent `shutdown()`), `bootHost`, `BootHostOptions`, `BootedHost`, and the closed ownership-failure
  type a launcher maps to its own presentation.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv` — for
  `boot.ts`); `persistence` (`dataDir` — where `crashLog.ts` writes); the feature modules it composes (per the parent dependency graph, incl. `fs`'s
  `resolveWorktreeFile` for the `/files` route); Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`.

## Get right

- Every registered WS command is debug-traced by **method name only** (`ws <method>` / `ws <method>
  failed`); a name absent from the closed handler registry is traced as fixed `ws unknown method` instead.
  Never trace raw unregistered method names, params, or handler error text, which can reflect credentials
  and user-supplied values; see `submodule-server-log`'s privacy rule.
- WS commands return values directly; only events + extension-UI + **`project.updated`** (published from
  the `projects` module's injected publisher) + the workspace lifecycle trio
  (`workspace.created`/`updated`/`removed`, published from the `workspaces` module's injected publisher) +
  **`session.deleted`** (published from the agent module's injected publisher) + **`provider.changed`**
  (published from auth's Central/runtime invalidation seam) use push channels. Every
  **broadcast** push channel a client should hear must be `ws.subscribe`d in the WS
  `open` handler — a publish on an unsubscribed topic reaches nobody, silently. Two channels are deliberately
  **not** subscribed and not broadcast: `terminal.data`, `terminal.exit` and `terminal.detached` are sent with
  `ws.send` to the single *attached* client (see [[submodule-server-terminal]]). Adding a terminal-style
  addressed channel means wiring a publisher, not a subscription.
- The host is the single place features are wired together — features never reach back into it.
- Ownership identity is the canonical data directory, not process name or app kind: CLI and desktop must
  exclude one another for the same state. No timeout authorizes a second writer. Graceful close and process
  death release the kernel listener; there is no stale artifact or force-unlock path.
- `shutdown()` is safe under concurrent signal/native-quit calls: callers receive one promise, lifecycle
  work runs once, and resource disposal/ownership release remain ordered after session settling.
- **A send (prompt/steer/followUp/answerQuestion) is acked when ACCEPTED, not when the turn ends**
  (`ackSend`): pi's send methods resolve only at turn end, and a turn can outlive the client's request
  timeout (long tool rounds and multi-minute reasoning turns are routine) — awaiting completion would
  surface a phantom "request timed out" over a healthy turn. A rejection inside the ack window still
  fails the request (bad model / missing key; for `answerQuestion` also an unknown/answered/superseded
  call — `assessAnswerability`'s loud verdicts); later faults reach the client via the event stream.

## Reflection layer

A precision-over-recall pass that verifies the agent reviewer's findings before they become a fix
request, inspired by the deterministic layers of Alibaba's open-code-review. Phase 1 is the synchronous
positioning gate in the `add_review_comment` seam (`reviews.anchorProblem`). The rest:

- **Independence.** The reviewer that *found* an issue must not be the one that *validates* it (correlated
  errors), so verification runs as a **separate pi session** with its own `reflecting-findings` skill
  (adversarial-verify: refute each finding against the code, cite the proving line, default to `refuted`
  under doubt), not a reviewer self-check.
- **`reflect_finding` seam** (next to `add_review_comment`): `(commentId, verdict: "kept" | "refuted",
  confidence, reason)` → host writes the finding's `reflection` via `reviews.setReflection` (persisted;
  the client badge updates live off the same publish).
- **Deferred fix-send, not deferred verdict.** Reflection changes only *which findings ride the fix
  request*, never the verdict outcome or the queue advance — so `review_verdict` records the verdict and
  settles the queue inline exactly as before; only the request_changes **cycle-1 send** is held. That
  branch fires a **transient reflector session** (`fireReflection`) over the candidate findings (agent
  drafts, non-stale) and stashes a `PendingFix` keyed by the reflector's session id. The host cannot
  await a sub-session (sends are fire-and-forget — see "Get right"), so resumption rides the settle tee:
  `maybeResumeReflection(settledSessionId)` sends the fix once the reflector settles, carrying only
  `reflection.verdict !== "refuted"` findings; refuted ones stay drafts, badged, for the human.
  **A refuted-empty candidate set sends nothing; a candidate-empty verdict still sends.** These are
  different states, and `sendReflectedFix` tells them apart by `pending.candidateIds.length`, not just by
  "nothing survived": when the verdict came with **no inline findings at all** (a whole-change concern
  living only in the verdict `note`, `candidateIds` empty from the start — this never goes through
  `fireReflection`, which only fires over a non-empty candidate set), the plain `renderFixPackage` (the
  note is embedded in it) still goes to the worker with no comment package attached — that *is* the fix
  request. Only when candidates existed and reflection refuted **every one of them** does the send skip
  entirely: delivering a bare fix request with no surviving findings would ask the worker to act on
  nothing, so no fresh artifact delta ever lands and `maybeAutoReReview`'s trigger has nothing to fire on,
  stranding the item at `changes_requested` forever with its one auto cycle spent but never resolved.
  That branch calls `recordAgentChangesRequested({..., autoCycles: 2})` directly — the SAME terminal
  settlement `review_verdict` uses when the cycle is already spent or auto-fix is off — so the item reads
  as a normal "the human decides now" state, and notifies the reviewer chat why nothing was sent.
  The send follows the same pre-turn rollback guarantee as every review send: a rejected
  `followUpSession` (worker busy/detached) `rollbackSend`s the just-marked findings back to draft —
  without it they'd strand as falsely-sent on a `changes_requested` item whose one auto cycle is
  already spent, invisible to a later manual Ask-to-fix.
  **Reflection never deletes — it annotates; automation trusts the annotation, the human sees
  everything.** A transient session per pass (not a pinned reflector) keeps `PendingFix` keys unique so
  concurrent reflections never collide; the cost is a reflector chat per fix cycle. A create/fire failure
  falls back to `sendReflectedFix` with no reflection recorded (every candidate `kept`), so a reflector
  that can't run never strands the fix cycle.
- **Badge.** Derived in `reviewModel.ts` (`statusLabel`/`threadLabel`) and rendered token-only across the
  review panel + both inline cards; `refuted` takes precedence over `stale`/`outdated`.

### Drift & overwrite

A finding is anchored to `side:"worktree"` (the live file — it follows the code inline). When a *later*
plan step overwrites the reviewed lines, `reanchor` degrades it to `outdated` (`reviews.ts` reanchor),
but `maybeAutoReReview` triggers on SHA-watermark growth, or (the path-list fallback's equivalent, no
sha to watermark) the record reading `unreviewed` while a spent auto cycle still stands on record — see
`todos/SPEC.md`'s auto-cycle durability. The **derived `stale`** condition guards
this — `anchorState === "outdated"` AND the finding's origin sha superseded on its step
(`todos.reviewedShaSuperseded`). Every agent finding carries `origin` (step + session + reviewed sha,
stamped from the reviewer session's current step via `currentReview`); `isFindingStale` drops stale
findings from the auto-fix set (`review_verdict`). The client badge rides a **server-derived, non-persisted
`stale` flag**: `markClientStale` enriches every snapshot crossing to the client (`review.get` +
the `review.changed` broadcast) — the host is the only ring that can, since staleness joins a finding's
`origin` (reviews) to its step's commits (todos). `stale` is never a persisted field.

Preserving the *original* reviewed code was considered and rejected for V1: reconstructing it after the
fact from `reviewedSha` is unsound (the finding's textQuote came from the add-time worktree, which is not
guaranteed to equal that blob), and add-time snapshotting is real storage cost for low value (a finding
whose code was overwritten is usually moot; its prose body survives regardless). If ever needed, the only
sound route is snapshot-at-add, never freeze-on-drift.

### Persisted delta (whole phase)

One optional persisted `ReviewComment` field carries finding provenance: `origin?: { todoId, reviewedSha,
sessionId }` — **landed**. The wire `stale?: boolean` is derived by the host per client snapshot, never
stored. The `reflection` verdict field lands with the verifier above. No new tool parameter, no new
`status`/`anchorState` enum value.
