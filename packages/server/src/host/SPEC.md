---
id: submodule-server-host
type: submodule-design
status: active
title: host — the browser↔host wire
parent: module-server
depends-on: [module-contracts]
tags: [v1, host, public-surface-checked]
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
  current runtime generation (clients re-read status/models), and the `provider.*` handlers—including
  `provider.jbcentralQuota`, whose handler composes `settings`' enabled/interval values with `auth`'s closed
  cached read so the siblings never import each other—the
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
  path: bounded `settleSessionsForShutdown()` + awaited `shutdownAnalytics()` first, then `stop()`). The
  bounded settle includes hidden delegation children even when their parent is
  idle, plus child cascades already started by a concurrent removal, so graceful quit does not let a
  background child lose its terminal abort/tool result; `crashLog.ts` (`installCrashLog` — the `uncaughtException`/`unhandledRejection` report
  appended to `<dataDir>/logs/crash.log` and echoed to stderr, then `exit(1)`: in-process pi means such a
  fault is the whole host's, and a launcher started without a terminal otherwise loses its only trace.
  Never a recovery, and never installed under `NODE_ENV=test` — a unit-test process reports its own
  faults. It renders the throw via the `log` module's `describeError`, so crash reports and log lines
  agree, but keeps its own sync append — the death path must not depend on the logger's state);
  `boot.ts` (`bootHost` → await `initLogging` — debug level when the launcher passed `verbose` — then
  install the crash report, resolve the login-shell PATH, pre-warm the same Central watcher/runtime
  initialization before choosing the serving port, await `createServer` (which idempotently enforces
  runtime bootstrap for low-level embedders), and write the `listening on` info line (see
  `submodule-server-log`). Its
  SIGINT/SIGTERM handlers await that same shutdown before process exit. Settling aborts streaming sessions
  and waits bounded so pi persists their "Operation aborted" tool results and transcripts land paired; an
  immediate exit would strand mid-tool transcripts on restart repair); `handlers.ts` (the WS method→handler
  registry, including `workspace.rename` as the direct manual door into
  `renameWorkspace(id, name, { lock: true, renameBranch: false })` — the workspaces module changes only the
  display label, persists, and publishes it, so the handler never mutates Git, emits, or patches a client
  separately — and the **Skills-manager set**: `skill.list` / `skills.state` / `project.skills` build
  the admission context from `projects` (+ the
  workspace's `skillOverrides` when workspace-scoped) and pass it into agent's `listSkillCommands`/
  `listSkillCatalog`; `session.list` decorates agent's `listSessions` summaries with
  `openTodos: countOpenTodos(…)` per session (a host-only composition of `agent` + `todos` — `agent`
  stays todos-free; a failed count omits the field, never fails the list); **`todo.requestFix`** is the
  same kind of composition (`todos` records + renders the fix package, `agent` delivers): the package is
  fired **detached** into the item's own chat as a **structured `todo-review-fix` custom message** —
  `sendReviewFixToSession` (`fireTodoFixPrompt`), which calls `AgentSession.sendCustomMessage` with the
  rendered package text as `content` (what the agent reads) and `ReviewFixDetails`
  (`buildReviewFixDetails`: item id/title, the feedback note, and slim path/line-resolved findings) as
  `details` (what the chat card renders), `deliverAs: "followUp"` + `triggerTurn` — **not** a synthetic
  user turn (#363). Wrapped in `ackSend` exactly like the old `followUpSession` path, so a pre-turn
  rejection rolls the review record back (`rollbackTodoFix`) and surfaces as an extension-UI notice, so an
  undelivered fix request never strands as `changes_requested`.
  The manual fix package **carries the item's open agent findings** exactly like the automated cycle
  does (`itemFixFindings` — this item's unstale agent-authored drafts by `origin`, `markCommentsSent` +
  `buildSendPackage` under `withReviewLock`): with auto-fix off, the verdict path sends nothing, so
  without this the worker never sees the reviewer's findings and they strand as drafts under a later
  approve. Package rendering happens before those findings are marked sent; every preparation failure
  identity-checks and rolls back exactly the `changes_requested` record this request wrote, plus any
  marks, so it neither strands a failed request nor overwrites a newer decision. The same identity-safe
  compensation runs on detached pre-turn rejection;
  **`todo.remove`** layers a host-side guard in front of `todos`' own, together covering the item's
  full in-flight lifetime — neither alone does: `removeTodo`'s durable `pending` mark covers
  `startTodoReview` (synchronous, at start/enqueue) until the verdict clears it;
  `isItemUnderActiveReview(sessionId, id)` reads the in-memory per-item latches — the fix latch
  (`claimItemFix`) and `planReviewQueue`'s active set — and covers the tail `pending` misses: the
  verdict clears the durable mark, but the fix delivery that follows it is still in flight. The host
  injects that in-memory guard into `removeTodo`, and the queued removal evaluates it together with the
  durable guard immediately before deleting; checking before enqueue would leave a wait-behind-reconcile
  window in which a review could start and reach a verdict. A manual or automatic fix claims one
  in-memory per-item latch before its first await and remains part of that guard through package
  preparation and fix-send acceptance/failure; overlapping manual sends are rejected, and removing the
  item cannot send a captured fix package for a TODO that no longer exists;
  **`todo.startReview` / `todo.reviewAll` + `host/requestReview.ts`** compose the agent reviewer. A plan
  step is reviewed by a **hidden, ephemeral delegation child** of the plan session (`agent`'s
  `runReviewSubagent`) carrying OUR reviewer role — `host/reviewerRole.ts` owns the system prompt, the
  read-only tool set, and the fenced-JSON output contract; the review package `todos` renders is a change-set
  **reference only** and never names tools. The child returns final text, the host parses the structured
  verdict (`parseVerdict`, lenient on findings, strict on the verdict word) and owns every state
  transition. There is no reviewer chat, no reviewer-authored tools (`review_verdict` /
  `add_review_comment` / `reflect_finding` are gone with it), and therefore no reviewer session to
  monitor, register, or unstick — the whole crash-recovery surface those needed collapses into the
  awaited promise: a child that errors, aborts, or returns unparsable text rejects, and the `catch`
  clears the item's `reviewing` mark (`cancelTodoReview`) on the spot.
  **Two entry points, one recording path.** The worker's own `request_review` tool (`handleRequestReview`)
  awaits the verdict and returns it as the tool result — the worker reads `composeText` and fixes inline.
  The Start review / Review All buttons (`startPlanReview`) mark the item `reviewing` **synchronously**
  (so the panel shows the pulse the instant the client re-reads the plan), run the review on the plan's
  serial chain, and deliver the outcome through the record + the Review tab. Both funnel into
  `recordVerdict`: `approve` settles the item (`approveTodoReview(…, "agent")`); `request_changes` files
  every finding into the Review tab (`fileFinding` — an inline comment when `reviews.anchorProblem`
  accepts the position, else review-level, best-effort so a bad anchor never fails the review) and then
  spends the fix budget.
  **The 1-cycle cap is the same on both paths.** `canAutoFix = reviewAutoFix !== false && spent < 1`
  (`todoReviewAutoCycles`), and the record is written with `autoCycles: canAutoFix ? 1 : 2` — `1` means
  "the worker was actually asked to fix, this item is mid-cycle", `2` is terminal ("the human decides
  now"). Recording `1` without asking anyone to fix would strand the item: `maybeAutoReReview`'s trigger
  reads exactly that value, and nothing would ever produce the fresh delta it waits for. On the button
  path a live budget also **delivers the fix to the worker chat** (`deliverFixToWorker`): the item's
  origin-scoped draft findings (`itemFixFindings` — this item, this worker session, non-stale; an
  unscoped sweep would carry other steps' findings into this worker and strand them as falsely-sent) are
  rendered with `renderFixPackage` + `buildSendPackage` and sent as the structured `todo-review-fix`
  message under `ackSend`, with `rollbackSend` returning them to `draft` on a pre-turn rejection. The
  tool path never sends — the worker already has the verdict in its tool result, and a second copy as a
  message would double the instruction. With the budget spent or auto-fix off, both paths leave the
  findings in the Review tab for the user and say so (`composeText`).
  **One review at a time per plan** (`host/planReviewQueue.ts`): `enqueuePlanReview` chains each run onto
  the plan's promise, so Review All starts N steps but runs them serially — N concurrent provider streams
  is what the chain exists to prevent. The same module holds the per-item claim both entry points check,
  so a step already under review is refused rather than reviewed twice with two verdicts racing onto one
  record. `todo.reviewAll` reports `{ total }` — the count it actually started — and `alreadyRunning`
  only when it started nothing while the plan's chain is still busy. The module is pure mechanics with an
  injected runner (no agent dep), which is also how `planReview.test.ts` drives the whole verdict →
  record → deliver path without a provider.
  **Auto re-review** (`maybeAutoReReview`, tee'd off the reconcile hook on `isTodoToolEnd`): after a fix
  lands and the worker re-marks the step done, exactly the items still inside their one auto cycle
  (`autoCycles === 1`, not `reviewing`, `status: "done"`) get re-reviewed. The trigger accepts either a
  fresh commit delta on a `changes_requested` record OR a record reset to `unreviewed` — the latter is
  the path-list fallback (`todos/artifacts.ts` drops the record when the redo can't be committed), where
  a surviving spent cycle is itself the "a fix landed" signal, there being no sha to watermark against.
  **`approve` is rejected while the item has open findings** is now structural rather than a tool gate:
  the reviewer cannot approve and file findings in the same verdict, and `resolve_comment` stays the
  WORKER'S tool — `reviews.applyAgentResolution` only resolves a `sent` comment, and only when the
  calling session equals the chat `markCommentsSent` recorded it as delivered to;
  `project.setTrust`
  acknowledges the aliases present at grant via agent's
  `listProjectAliasSkillNames`; `project.acknowledgeSkills` / `project.setSkillEnabled` /
  `project.setGroupEnabled` / `project.aliasSkills` / `workspace.setSkillOverride` mutate/read the persisted
  toggles; `session.reloadResources` re-scans a running session — the composition stays here; `agent` never
  imports its sibling. `createServer` also wires **`setSkillAdmissionResolver`**, mapping a session's
  `workspaceId` → its project's trust/acknowledged/disabled + that workspace's overrides (fail-closed), so
  `agent` gates skills without importing `projects`/`workspaces`). The sibling subagent policy is composed
  here the same way: `createServer` wires `setSubagentsEnabledResolver` to map an explicit
  `Workspace.subagentsOverride` when present and otherwise use `AppConfig.subagentsEnabled` (unknown
  workspace fails closed), the settings
  publisher asks `refreshSubagentTools()` to reevaluate all live sessions after any global update, and
  `workspace.setSubagentsOverride` persists through `workspaces` then refreshes only that workspace. The
  two authoritative publishers remain the clients' convergence path; the host-to-agent refresh changes
  runtime capability, not frontend state;
  **Review marks are memory-plus-disk, and only the disk half survives a restart.** The serial chain and
  the per-item latches are in-memory; `pending` marks are a disk sidecar. `createServer` calls
  **`reconcilePendingReviewsOnBoot`** once, before the server accepts connections: it walks every project's
  every workspace and calls `todos`' `clearAllPendingReviews(worktreePath)`, which sweeps every session's
  sidecar and drops every `pending` entry unconditionally — safe because nothing has been enqueued in this
  fresh process yet, so every mark found necessarily predates it. Without this, a review in flight at the
  last shutdown would spin `Reviewing…` forever and Review All would skip the item forever (its own
  `reviewing !== true` filter);
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
  creation, and a failed operation releases it rather than poisoning the queue. The plan-review verdict
  path joins the same lock: `deliverFixToWorker`'s read→render→mark pass stays under it, so a Clear
  cannot replace the candidate ids between those stages. Deliberately unlocked: `review.get` (its load → re-anchor → persist is one synchronous pass,
  and hydration must not queue behind a send) — plus the two mutations that remain fully synchronous,
  `reviews.resolveCommentFromAgent` (the worker tool seam) and `reanchorWorkspace` (the fs-watch tee):
  both re-read the snapshot from disk before writing, and neither removes a comment nor closes the
  review, so landing in a send's gap can't invalidate the package's ids.
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
- **Activity fan-out:** `createServer` installs the agent module's activity publisher and broadcasts each
  `SessionActivityPayload` on `session.activity`, which the WS `open` handler subscribes for every client
  alongside the other session channels; `session.activityList` serves the cross-workspace snapshot, since
  pushes are never replayed and a reconnecting client would otherwise show a stale rail. That handler is
  where the workspace **registry** meets the agent: it passes every record's `{id, cwd}` (via
  `listAllWorkspaceRecords`) so the agent can union on-disk sessions without ever performing a persistence
  lookup of its own — the same shape as `session.list` receiving one workspace's `worktreePath`. This module also
  satisfies the agent's **`setActivityProjectResolver`** seam by mapping a workspace id to its
  `projectId` through the workspace registry (unresolvable → `null`, and the agent then publishes
  nothing) — the registry lives here, so attribution is composed here rather than the agent learning what
  a project is. Derivation, precedence, and lifetime belong to [[submodule-server-agent]]; the wire shape
  and why `projectId` rides each row are in [[module-contracts]].
- **CLI update notice:** a launcher may supply one optional asynchronous notice producer and fixed interval.
  `createServer` starts it after listening without awaiting it, repeats it without overlap, retains the latest
  successful immutable notice for later `server.welcome` snapshots, and publishes `host.updateAvailable` only
  when that notice first appears or changes. Failure/no-update are silent and preserve a known notice; shutdown
  clears the timer and makes a late result inert. The host owns only this capability composition—no feed,
  retry policy, updater, command, persistence, or launcher branch.
- **Interview invitation delivery:** the three user-send handlers share one post-`ackSend` path that
  filters control traffic once, tracks anonymous `message_sent`, and records the local feedback count. The
  feedback module's injected publisher maps an eligible claim to addressed `feedback.interview` delivery
  for that request's opaque client key only when its socket-advertised protocol version supports the channel;
  delivery failure or final client reap after the reconnect grace releases the claim, while a transient
  reconnect retains and re-delivers it after `server.welcome`. A host restart has no claim to re-deliver, and
  the welcome clears the frontend's stale popup projection. Popup `feedback.respond` actions are ordinary
  replay-safe requests and never alter the Settings link.
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, `BootedHost`, `BuildKind`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, feature-introduction versions, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv` — for
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
  (published from auth's Central/runtime invalidation seam) + **`host.updateAvailable`** (published when the
  optional periodic launcher notice first appears or changes) use push channels. Every
  **broadcast** push channel a client should hear must be `ws.subscribe`d in the WS
  `open` handler — a publish on an unsubscribed topic reaches nobody, silently. Four channels are deliberately
  **not** subscribed and not broadcast: `feedback.interview`, `terminal.data`, `terminal.exit`, and
  `terminal.detached` are sent with `ws.send` to one addressed client. Adding an addressed channel means
  wiring a publisher, not a subscription.
- The host is the single place features are wired together — features never reach back into it.
- Separate host processes do not coordinate mutable state or events. They may use the same data directory,
  but each owns independent in-memory sessions, terminals, watchers, and connected clients; persistence
  conflicts are accepted rather than serialized by the host.
- `shutdown()` is safe under concurrent signal/native-quit calls: callers receive one promise, lifecycle
  work runs once, and resource disposal remains ordered after session settling.
- **A send (prompt/steer/followUp/answerQuestion) is acked when ACCEPTED, not when the turn ends**
  (`ackSend`): pi's send methods resolve only at turn end, and a turn can outlive the client's request
  timeout (long tool rounds and multi-minute reasoning turns are routine) — awaiting completion would
  surface a phantom "request timed out" over a healthy turn. A rejection inside the ack window still
  fails the request (bad model / missing key; for `answerQuestion` also an unknown/answered/superseded
  call — `assessAnswerability`'s loud verdicts); later faults reach the client via the event stream.

### Drift & overwrite

A finding is anchored to `side:"worktree"` (the live file — it follows the code inline). When a *later*
plan step overwrites the reviewed lines, `reanchor` degrades it to `outdated` (`reviews.ts` reanchor),
but `maybeAutoReReview` triggers on SHA-watermark growth, or (the path-list fallback's equivalent, no
sha to watermark) the record reading `unreviewed` while a spent auto cycle still stands on record — see
`todos/SPEC.md`'s auto-cycle durability. The **derived `stale`** condition guards
this — `anchorState === "outdated"` AND the finding's origin sha superseded on its step
(`todos.reviewedShaSuperseded`). Every agent finding carries `origin` (step + session + reviewed sha,
stamped by `fileFinding` from the review the verdict belongs to); `isFindingStale` drops stale findings
from the auto-fix set. The client badge rides a **server-derived, non-persisted
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
stored. No new tool parameter, no new `status`/`anchorState` enum value.
