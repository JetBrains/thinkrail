---
id: submodule-server-host
type: submodule-design
status: active
title: host — the browser↔host wire
parent: module-server
depends-on: [module-contracts]
tags: [host, public-surface-checked]
---

## Confirmed Issue operations

`issueStageActions` and `issueDeliveryActions` compose the server Issue delivery capability for bound
sessions. Their fixed previews reuse `ask_user_question`; transcript verification admits only the exact
submitted `Looks right` response. The private `issue-confirmations` journal snapshots bounded payloads,
reserves exclusive immutable intents before mutation, and makes completed receipts idempotent. A read-only
inspection reports missing/prepared/uncertain/completed status. Deterministic preflight happens before
intent reservation; after reservation, uncertain mutation stays fenced and requires remote inspection and
explicit user-directed recovery.
Host composition rechecks project trust, workspace ownership, committed checkout SHA/branch and live provider
identity. Delivery requires a canonical origin push URL equal to the authenticated project's HTTP clone
URL and a real default or explicitly selected target branch. It pushes the fixed SHA without force and
creates drafts only. A matching existing request at an older SHA is updated in place after its card is
confirmed; an exact-head request is reused without modification. Merged/closed requests are historical,
not active candidates: they neither cause ambiguity nor prevent another Draft request for the same
Issue/source branch. A deleted remote source branch can be republished by the confirmed non-force push. Delivery readiness is determined by the agent's work and validation, not a prior implementation-stage journal receipt; the delivery card freezes the current committed checkout and exact PR/MR content. Local staged,
unstaged and untracked files are excluded and do not block preparation or execution. The agent verifies
necessary files are committed and asks the human about doubtful exclusions; the host does not infer
file necessity. No stash, deletion, commit or local ignore mutation is performed by delivery. The exact submitted questionnaire receipt, repository identity, remote, Issue snapshot and checkout are still revalidated before mutation. A changed checkout requires a fresh card; uncertain intents remain fenced. The agent receives no token,
path override or merge/close capability.

Delivery refusals expose `ISSUE_DELIVERY_REFUSED` with closed, non-sensitive reason tags and a concrete
next action. Read-only preflight failures occur before intent reservation and remain eligible for a
refreshed confirmation. Once an intent is reserved, only a completed receipt or explicit inspection and
user-directed recovery can proceed; no replacement ID bypasses uncertainty. Every confirmation prepare/execute refusal is wrapped by host-local `issueContinuations`: return a
sanitized cause tag, fixed input snapshot and exact continuation questions. A real receipt authorizes
one memoized attempt; concurrent/replayed calls share it. A successful prepare continuation returns a
new normal/warned operation card needing separate approval, not remote mutation. Snapshots expire with
host restart or after 30 minutes, are bounded to 100, and can be disabled by
`THINKRAIL_ISSUE_CONTINUATIONS=0`. Invalid receipts grant no action. This is universal card offering,
not a promise that invalid targets/credentials become valid or uncertain writes resend.

`continueDespiteChecks:true` requests a one-shot warning card, not authorization: stage policy warnings
include closed Issue, missing design receipt, unexpected workflow labels and uncommitted files; delivery
collects executable policy checks including locked request state and session-stage mismatch into its
exact card. Missing/ambiguous repository selection and credential-bearing URLs cannot be invented or
made safe by a flag. The frozen payload includes each exception and still requires
the exact real answer. New facts invalidate that authority. Invalid identities, unavailable credentials
and uncertain intents still need repair or reconciliation. `recovery:"reconcile"` freezes observed
stage note/label or delivery MR evidence for the original operation; its exact card requires human
confirmation that the original request/process ended and approval to adopt the result. Completion
rechecks the observed result and records the recovery toolCallId without any remote write. Recovery
cannot complete during an active original execution in this host. Cross-process termination is a human
assertion; generic override and uncertain resend are not implemented by this flag. There is no silent or permanent force-continue switch. Bounded failure
sidecars retain only known sanitized confirmation/delivery reasons for inspection after dispatch.

## Responsibility

The wire and composition root: `Bun.serve` HTTP+WS, static SPA serving, the WS method→handler registry,
channel fan-out, and the process-boot wrapper both launchers share.

## Boundary

- **Owns:** `server.ts` (async `createServer` first asks auth to start Central artifact watching and publish
  the initial current PI runtime, falling back to plain PI with closed `load-failed` state when needed, then creates
  `Bun.serve` with `/health`, `/ws` upgrade, a
  **`GET /files/<workspaceId>/<relpath>`** route streaming a worktree file's raw bytes from `Bun.file`
  after classifying only its bounded 8 KiB head (via `fs`'s `resolveWorktreeFile` — path-contained; bad
  id/escape/miss → 404; `Cache-Control: no-store`, because the worktree moves under the URL) so the
  markdown viewer's relative `<img>`s resolve — an optional `?maxBytes=N` (the palette preview's cap)
  answers 400 for a bad cap, 413 before any byte when the file is larger, and otherwise exactly the
  `Content-Length` it announced, so a file growing meanwhile adds nothing — the sibling
  **`GET /blob/<workspaceId>/<oid>/<relpath>`** route serving that path's bytes **at one commit or tree**
  (`git.readBlobStreamAtAsync` behind a 40/64-hex `oid` — a diff range's `resolvedOriginalOid`, so the URL
  names immutable content and answers `Cache-Control: public, max-age=31536000, immutable`; the Git
  primitive requires a blob, so trees/commits/gitlinks are 404 alongside a bad id/oid/escape/absent
  path, and so is a chat without a project, before any git). Before opening a blob body, the route performs a bounded `git cat-file -s`; objects above
  `BLOB_SIZE_LIMIT` (64 MiB — the size of the largest image, PDF or notebook a review surface renders
  in one piece, and the bound on what one `change.revert` receipt may pin) are refused with 413. An
  accepted blob is **streamed**: only its 8 KiB sniff head is awaited for the headers and the rest relays
  `git cat-file`'s stdout chunk by chunk, so concurrent image or PDF diffs cost pipe buffers, not blobs,
  of host memory; the body goes out chunked (a streamed body carries no `Content-Length`), a consumer
  that disconnects kills its `git` — through the body's cancel once it streams, and through the
  request's `signal` while the sniff head is still awaited — and the relay's own deadline is five
  minutes, so a slow reader stalls `git` on the pipe rather than racing the 55 s network budget. Both routes exist
  because `fs.readFile` and `git.diffFile` answer `""` for bytes they must not decode, so a byte-only
  resource is fetched over HTTP instead. Both derive `Content-Type` through the shared byte classifier plus
  filename fallback (falling back to `application/octet-stream`) and
  send `X-Content-Type-Options: nosniff`; active same-origin types (`text/html`,
  `application/xhtml+xml`, `image/svg+xml`) additionally receive
  `Content-Security-Policy: sandbox; default-src 'none'`, so direct navigation cannot execute repository
  script, the **`GET /images/<sessionId>/<sha>`** route, delegated to [[submodule-server-images]]'s `serveImage`.
  It serves chat images as references, by allow-listed raster type only, with `no-store`, and answers
  any method but `GET`/`HEAD` with 405; the host injects its
  source (agent's live lookup plus the tombstone check), calls `forgetImageSession` on every `session.deleted`,
  and calls `resetImages` on stop. Then the **`/fonts/<file>`** route (`fontRoutes.ts`, ahead of the static fallback) over the
  [[submodule-server-fonts]] folder — the host's one HTTP write route, and besides `/images` (GET/HEAD only)
  the only route that checks its method: `GET` serves a font by its extension's type (`font/ttf|otf|woff|woff2`) with
  `Cache-Control: no-cache` (list URLs carry a content version) and 404s any name `fontFileKind` refuses,
  a collection, or a missing file; `PUT` (behind the upload guard below) answers 400 for a refused name,
  else stores the body through `saveUserFont` and answers that file's entry as JSON: 200, 413 `too-large`
  (checked against `Content-Length` before reading and again while streaming), 409 `too-many`, 422
  `unsupported-collection`/`invalid-font`, or 500 `unreadable`; any other method is 405 with
  `Allow: GET, PUT`, the `fonts` poller's `fonts.changed` nudge reaching
  only sockets whose `?protocol=` is at least `FONTS_PROTOCOL_VERSION`; the **`/speech` socket**
  (`SPEECH_SOCKET_ROUTE`, refused below `SPEECH_PROTOCOL_VERSION`), which shares the one `Bun.serve`
  websocket handler but is tagged at upgrade. Its `open` / `message` / `close` go straight to that
  socket's [[submodule-server-speech]] relay, so it never joins the `clientKey → socket` registry, the
  replay cache or any channel: binary 20 ms audio frames would otherwise be hashed and retained
  per request. `host` publishes
  `speech.changed` whole to v117 sockets, which also get `ServerWelcome.speech`; static serving with
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
  let the replay start a second execution of a handler that has not finished. Abandoned work (below) still
  holds the reap: the reap's owner cleanup (terminals, interview, MCP probes) must not run while one of the
  client's handlers can still act for it — an `mcp.login` awaiting its ownership guard would otherwise start a
  probe owned by an already-cleaned client.) **Nothing in that cache is ever evicted**, because a
  successful `send` says the bytes were queued, not that the page read them, and a socket that dies holding a
  reply is indistinguishable from one that flushed it — so any result dropped on the host's own initiative may
  be the one a replay is about to ask for. A result leaves only on the client's own word, via two frames handled
  here and never routed to a handler: `{ ack: [id] }` names responses it has **read** (the steady state) and
  requests whose own deadline fired, and `{ resume: [id] }` on each reconnect names everything it still
  considers **unresolved**, freeing all other settled results. A still-running entry that an `ack` names, or a
  `resume` omits, is **abandoned**: the page will never replay that id (ids only grow, and a timed-out id has left
  its queue), so the entry stops counting toward the *live* limit and is dropped — never retained — the moment
  its handler settles; a duplicate frame arriving while it runs still joins the same promise, so abandonment
  cannot cost exactly-once. Before this (#974), a request the page had given up on kept its slot until its
  handler settled, and a result settling after a reconnect went to the dead socket and sat until the next
  `resume`, so enough slow requests filled the namespace and refused every later request from that window.
  Abandoned work is still running work, so it stays bounded (the tracked ceiling below). Each `ack`/`resume`
  that abandons running work logs one `warn` with the per-method counts; `RequestAbandonedError`
  (`code: "REQUEST_ABANDONED"`, tagged with the method) is reported once per method per launch and for at most
  10 methods, because it shares the `request` source's fixed per-launch report budget with genuine handler
  failures and the overflow report, and a reload's new client key must not renew it. Requests that settle
  inside the page deadline yet arrive faster than they settle can still fill the live limit; abandonment does
  not address that. `resume` is what makes receipts safe to lose — an ack can die in a socket buffer exactly like
  a response can, and nothing would ever re-send it, so each reconnect restates the whole truth instead of
  confirming the confirmations. Cost is bounded instead by **three hard limits, each enforced where its size
  becomes known**: two entry counts on the way *in* — 512 live entries (pending or settled-but-unread, the
  page's working set) and 2048 tracked entries (live plus abandoned, so a page that keeps timing out a hung read
  cannot start handlers without bound; any finite ceiling eventually refuses a permanently hung workload, and
  4× headroom only buys time to report it) — where a full namespace refuses new ids
  (`RequestReplayOverflowError` → a normal `ok: false`) while still answering every id it holds, and the
  retained bytes on the way *out* of the
  handler, since a response's size is unknowable at admission (`fs.readFile` returns a whole file) and in-flight
  work weighs nothing, so an admission-time byte check would bound the count and nothing else. A result that
  would breach the byte budget is not retained: the entry stays as proof the work ran, so its replay fails
  (`RequestReplayUnretainedError`) rather than re-executing, and the response the caller was already sent is
  unaffected. Neither limit can cost exactly-once — one refuses work that has not started, the other keeps the
  record of work that finished and drops only its answer. A refusal is `CodedError("REQUEST_REPLAY_OVERFLOW")`
  in the reply's `errorCode`, its message free of the client key because it reaches the page's toast. The
  first refusal of an episode logs a `warn` with what the namespace holds per method — pending, settled and
  abandoned — and reports the error tagged with the method occupying the most entries (the
  refused request is usually a bystander), so a full namespace points at what filled it — a lead, not proof of
  the root cause — instead of vanishing into a debug line (#974). An episode ends only once the namespace is
  below 90% of both counts, so a namespace hovering at a cap
  does not log and report on every freed slot (the `request` report source has a fixed per-launch budget),
  the **`provider.login`** channel publish (the `auth` module's session-less login-frame bridge, wired like
  `pi.extensionUi`), the **`provider.changed`** invalidation broadcast after auth changes the Central status or
  current runtime generation, after every successful in-app provider login (not an MCP sign-in), and after
  every `provider.logout`, so
  other clients and the Welcome surfaces see the new provider (clients re-read status/models), and the `provider.*` handlers—including
  `provider.jbcentralQuota`, whose handler composes `settings`' enabled/interval values with `auth`'s closed
  cached read so the siblings never import each other—the
  **`watch` wiring** (inject the
  `workspace.fsChanged` publish callback into `watch` and inject `agent`'s project-skill path classifier so
  each capped batch carries independent `skillChange: none|detected|unknown` evidence; inject `git`'s
  `ignoredPaths` (`setIgnoredPathsResolver`) without the folders `agent`'s `mayHoldProjectSkills` matches,
  so the Linux watcher still detects a skill edit under an ignored `.claude/` (an ignored folder inside a
  skill is still watched unless its name starts with a dot, like `.venv`), and without `.thinkrail/context`,
  the folders on the way to it and everything under it, so neither its seeded `*` `.gitignore` nor a user
  rule like `.thinkrail/` silences the agent's docs there (the cost: on Linux an ignored tree there takes
  a watch per folder, as with the recursive watcher, so a big built or unpacked tree belongs elsewhere);
  expose
  **`workspace.watchReady`** as the typed preflight that awaits a fresh watcher's conservative startup nudge
  before a web skill-loading flow
  captures its baseline and reports whether the watcher was already known ready (the client's replay-safe
  conservative fallback; its optional `prewarm` flag is forwarded into `watch`'s bounded prewarm-only tier,
  so pre-selection warm-ups never grow the watcher registry unboundedly); plus the **repo-metadata** callback (`setRepoMetaPublisher`) fanned out to **three**
  convergences for a git-metadata write in a watched worktree: `recordWorkspaceHead` (the settled
  lifecycle's commit proxy — stamps activity only when the sha actually moved, see
  [[submodule-server-workspaces]]),
  `syncWorkspaceBranch` (**re-sync a workspace's branch to its live checkout**, any kind — host-mediated,
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
  **analytics wiring** (`initializeAnalytics` at boot from launcher provenance, destination, and per-run
  additional-data suppression; startup grants the additional tier only when `analyticsEnabled &&
  analyticsConsentConfirmed`. After boot, the settings publisher still broadcasts every merged config but
  changes the analytics grant only when its successful applied update explicitly carries `analyticsEnabled`,
  so unrelated writes preserve the current grant and the dialog's preference prime can enable it.
  `analyticsConsentConfirmed` controls the web prompt lifecycle. Its unconfirmed on-prime may enable ordinary
  additional capture, but browser attribution starts only from confirmed-on state: directly after the final
  applied dialog update (the UI is ready), or for a saved choice only through the launcher's explicit
  `RunningServer.startAttributionClaim()` readiness signal after normal UI readiness. Revocation cancels the
  claim generation. Basic
  events remain on in human runs. Consent changes clear additional-event correlation so re-enabling cannot
  reconstruct pre-consent work; campaign-only enrichment is inactive while off and restored from its strict
  server record when on without retrying a consumed claim.
  `shutdownAnalytics()` remains a best-effort drain in `stop()` and awaited by graceful shutdown;
  every capture site lives here, including the existing basic events: `chat_started` in `chatSession.ts#startChatSession`, every chat start's one path (the host's new-chat
  resolution decides `none` for a chat created with no usable model instead of pi's placeholder; otherwise
  the created session's actual model is reported), `message_sent` (via the
  local `trackSend(mode, text)`) after an **accepted** `session.prompt`/`session.steer`/`session.followUp`
  (`prompt`/`steer`/`follow_up`; skipped when contracts' `isControlMessage(text)` — the client's TODO
  wake-nudge rides the same methods and is not a user message; `session.respondToTool` is a tool reply,
  not a message either),
  `provider_login` from the
  login-publisher tee's terminal `success` frames with the method (`oauth`/`api-key`) looked up from
  `loginAnalytics.ts` — the loginId→method map the `provider.loginStart` handler records (and
  `provider.loginCancel` clears; an unknown loginId tracks nothing, fails closed) — +
  a successful `provider.jbcentralConnect`→`applied` (failed actions never count) — per
  `submodule-server-analytics`,
  feature modules never track). Basic login/chat/send events add the closed auth category from their own
  session/login generation, never from a later global runtime; sends snapshot provider/auth before dispatch.
  Opaque-loader provider membership identifies Central without opening its auth/configuration surface.
  Additional setup/run/task/review/PR observations use the closed triggers in
  [[submodule-server-analytics]], with transient consent-scoped correlation and task-artifact reconciliation.
  Host alone mediates these events; analytics initialization emits the packaged-install lifecycle event,
  while no provider-change capture exists.
  Setup observes existing read results, never triggers provider work; only explicit setup mutations count
  (`dialog.selectDirectory` is one: `directory_pick` with a null path as `cancelled`; `project.open` maps the
  projects module's `NOT_GIT` / `ALREADY_OPEN` coded errors to the closed reasons, everything else `unknown`).
  Run timing starts at canonical `agent_start`, with local send intent recorded before calling pi (not
  after `ackSend`); unproven provenance stays unknown and retries remain one cycle until `agent_settled`.
  Accepted queued origins survive send resolution until canonical cycle observation; rejected sends do not
  contribute. Consent clearing preserves pre-grant cycle markers, while settlement, queue clearing,
  session deletion and full host reset release their corresponding transient intent state.
  Task observation reads reduced group state synchronously through the existing pi-free `TodoStore` /
  `groupStatus` boundary before a completion-capable mutation, then reads artifacts after reconciliation;
  wire edits wait for existing artifact work rather than create new Git writes for telemetry.
  Completion evidence and deduplication wait for the workspace's existing reconciliation queue to converge,
  including replacement passes after plan drift, and retain the mutation's original consent grant.
  Empty/newly-hydrated groups and completion by deletion do not count. These memory-only observations
  retain a grant's capture before asynchronous work and never replay across revocation.
  `stop()` → immediate agent-session cleanup, then `persistTerminalSessions()` **before**
  `closeAllTerminals()`, then watcher/socket disposal and `restoreSeamDefaults()`: every resolver,
  handler and publisher `createServer` installed is scoped to the server's lifetime and returns to its
  module default, so a later server in the same process (the unit suite boots many) never inherits a
  stopped one's policy or publish path; `shutdown()` memoizes one asynchronous graceful
  path: bounded `settleSessionsForShutdown()` + awaited `shutdownAnalytics()` + `stopWorkspaceCreations()`
  (running checkouts are killed so the next start reports them `interrupted`) first, then
  `turnTracker.drain()` for the receipts those settlements started, then
  `settleCredentialWritesForShutdown()` — pi's `ModelRuntime.settleCredentialWrites()` on the active
  generation and on every runtime a live chat still holds, because an OAuth refresh spends its single-use
  token before the rotated one is saved (pi #11692) — then `stop()`). The
  bounded settle includes hidden delegation children even when their parent is
  idle, plus child cascades already started by a concurrent removal, so graceful quit does not let a
  background child lose its terminal abort/tool result; `crashLog.ts` (`installCrashLog` — the `uncaughtException`/`unhandledRejection` report
  appended to `<dataDir>/logs/crash.log` and echoed to stderr, then — for the first fault only — an awaited,
  ≤ 1 s analytics `reportFatalError` (tagged with the crash kind) before `exit(1)`; later faults in that window are still appended but
  neither re-report nor re-exit: in-process pi means such a
  fault is the whole host's, and a launcher started without a terminal otherwise loses its only trace.
  Never a recovery, and never installed under `NODE_ENV=test` — a unit-test process reports its own
  faults. It renders the throw via the `log` module's `describeError`, so crash reports and log lines
  agree, but keeps its own sync append — the death path must not depend on the logger's state);
  `boot.ts` (`bootHost` → await `initLogging` — debug level when the launcher passed `verbose` — then
  install the crash report, await the login-shell environment when the launcher passed
  `resolveShellEnv: true` (started before `initLogging`), apply the stored host environment
  (`applyHostEnvironment`, before any `getAgentDir()` reader), pre-warm the same Central watcher/runtime
  initialization before choosing the serving port, await `createServer` (which idempotently enforces
  runtime bootstrap for low-level embedders), and write the `listening on` info line (see
  `submodule-server-log`); `reportDesktopError(error, scope)` is the desktop launcher's handled-error door
  into analytics (source `desktop`). Its
  SIGINT/SIGTERM handlers await that same shutdown before process exit. Settling aborts streaming sessions
  and waits bounded so pi persists their "Operation aborted" tool results and transcripts land paired,
  except a session blocked on `ask_user_question`: shutdown deliberately leaves that call dangling and the
  next attach repairs it to an answerable ack; explicit user Stop remains the terminal-abort path); `handlers.ts` (the WS method→handler
  registry, typed `WsHandlers = { [M in WsMethodName]: WsHandler<M> }`, so a missing, extra, or mistyped
  handler fails typecheck; `handleRequest` narrows the wire's `unknown` params once, at dispatch, and
  most params are not shape-validated at runtime; `issues.*` is an explicit exception (below). The registry includes `workspace.rename` as the direct manual door into
  `renameWorkspace(id, name)` (no `branch` option) — the workspaces module changes only the
  display label, persists, and publishes it, so the handler never mutates Git, emits, or patches a client
  separately; `project.rename` and `project.move` likewise delegate to the projects module's `renameProject` / `moveProject`, which own validation and the push; both refuse the Chats container as either end. `client.reportError` hands the untrusted browser report to analytics' `reportClientError` (the
  only sanitizer) and always acks. Error tracking also rides two `server.ts` seams: every failed WS request
  is reported with its registered method (CodedErrors included), and `observeLoggedErrors` routes host
  `log.warn/error(msg, err)` calls as `host_logged` — so host diagnostics that carry an error go through
  the logger, never `console.*`. The host's `resolveNewChatModel` composes AppConfig settings with pi's global default model, the agent's settled available
  model list and Pi thinking clamp; `model.default` and chat creation share that resolver.
  `chatSession.ts#startChatSession` delegates to the guarded `createHostSession` factory, the one
  `createSession` call (also used directly by Issue startup): `session.create`, the review chat,
  Continue in workspace, the creation hand-off's kickoff chat (the New Workspace dialog's and an agent's
  `start_workspace`), and a chat without a project — `chat.create` and recovery through `session.create`,
  inside its per-chat claim, whose `assertClaimed` refuses a chat being deleted before, around and after
  the agent's barrier — all start their chat through it, so no path can diverge on the scratch folder, the
  resolver, the explicit model and effort, or `chat_started`. Its one bookkeeping in that factory (recent
  pick + `chat_started`): only a user's pick (`pick` — `session.create`, `chat.create` and a dialog's
  kickoff that **named** a model) is recorded as recent through `settings`' `noteRecentModel`, as is every
  `session.setModel`; a default-resolved creation, the review chat, Continue's destination and an agent's
  `start_workspace` are the host's or the agent's choice, not the user's, and are not recorded. Without an
  explicit model, an available saved model or an available pi global default, the resolver first applies
  pi's model preference to connections whose wire auth kind is not `env`, then to the whole available
  catalog. An ambient API key must not preempt a configured subscription; explicit selections, available
  saved defaults and pi's global default still take precedence, including environment-backed ones. This
  changes only new-chat resolution, never an existing session's model or a failed request's connection.
  `model.contextSettings` and `model.setContextWindow` delegate to agent's `modelContext`
  adapter and return its `ModelContextSetting[]`; the mutation names a provider/model target or all
  eligible pairs, never arbitrary model metadata, and successful saves reuse `provider.changed` to
  invalidate catalogs across clients. The four `customEndpoints.*` methods delegate to agent's
  `customEndpoints` adapter one-to-one; the host adds no state of its own. Existing review chats and plan-review
  subagents keep their own policies — and
  the **Skills-manager set**: `skill.list` / `skills.state` / `project.skills` build
  the admission context from `projects` (+ the
  workspace's `skillOverrides` when workspace-scoped) and pass it into agent's `listSkillCommands`/
  `listSkillCatalog`; the **MCP set** (`mcp.*`, `host/mcp.ts`) composes `agent`'s MCP
  service with `projects` (approvals, overrides, pi-level trust) and publishes `mcp.status` snapshots (topic
  subscribed only by clients at `MCP_PROTOCOL_VERSION` or later) plus `session.resourcesChanged`
  invalidations. Every request resolves its workspace and that workspace's project. Management mutations
  and probes re-read both after asynchronous ownership resolution, then check ownership and admit work
  in one synchronous call stack. A changed project identity, cwd or pi-level trust rejects the request
  for retry; approvals and overrides come from the latest record, not the pre-await snapshot. Project
  override patches merge atomically against the latest stored override. Wire enablement must be a boolean
  and record exposure must be `deferred`, `direct` or `hidden`; invalid values are rejected before record
  or per-chat disabled-set mutations. No write approves
  repository content the user has not reviewed: a project-file `mcp.add` (a name the file does not define
  yet) is the user's own entry, so its fingerprint is approved in the same request; `mcp.update` and
  `mcp.remove` read the on-disk entry's fingerprint in the scope's own file (the global `mcp.json` for
  user scope, the worktree's `.pi/mcp.json` for project scope) in the same synchronous step as the write
  and refuse, file untouched, when the request's `expectedFingerprint` differs from it
  (a missing fingerprint is refused at either scope); `mcp.update` carries approval to the written
  fingerprint only when the record approved that on-disk fingerprint — a rewrite of a pending or changed entry stays pending (a toggle rebuilt from a checkout's
  new entry must not approve it); an edit that arrives from the repo stays pending; `mcp.approve` refuses a
  fingerprint that is no longer the one on disk; `mcp.shareWithRepo` refuses when the project file already
  defines that name or holds an override not approved at its current fingerprint, else writes the record
  override as pi's override entry, approves it and clears the record copy. `mcp.revokeToolGrant` removes
  one always-allowed tool from the record and reloads no chat: the call guard reads grants live. After a mutation the affected
  live sessions (all for the user file, the project's for project files and record changes) are
  reconciled — only those whose effective config changed reload, through the gate. The reconciliation is
  started, not awaited (a failure is logged): agent reloads idle chats one after another, so the request
  answers with the fresh list at once and `mcp.status` pushes report each reload. `createServer` starts
  agent's `watchUserMcpConfig` (stopped with the server) and reconciles a workspace's live chats whenever
  its change nudge touches `.pi` or is truncated. Per-chat calls
  (`setSessionOverride`, `reconnect`) require the session to belong to the named workspace; `mcp.reconnect`
  runs agent's `reconnectMcpServer` (pi's notices stay out of the chat; pi's failure, masked, is the
  request's error) and refreshes that chat's status either way;
  `mcp.readOutput` reads agent's `readMcpToolOutput` for a session of that workspace only;
  `mcp.readLog` resolves the workspace, checks the name against pi's charset and returns agent's
  `readMcpServerLog` (pi keeps one `mcp.log` per agent directory, so it needs no session);
  `mcp.login` / `mcp.testConnection` start agent's probe with the caller's `clientKey` as owner and return
  its `loginId` (`mcp.logout` awaits the probe). Probe admission resolves the valid effective server from
  agent's host config loader with the current trust and policy; missing or invalid targets are refused,
  and Test connection requires that admitted config to be HTTP. An approved but invalid project entry
  never shadows a valid user target merely because its summary looks approved. All three refuse with
  `MCP_HANDLED_ELSEWHERE` wherever
  `mcp.list` would report `handledElsewhere` (the probe's loader forces `builtin:mcp`);
  `provider.loginReply` / `provider.loginCancel` route `mcplogin_*` ids to the probe with the caller's
  `clientKey`, and `createServer` sends probe frames to the owner's socket only, cancels the probes of a
  client when its retention timer finally reaps it (`cancelMcpProbesOwnedBy`, beside `releaseInvitation`;
  never on a mere socket close — a reconnect within the window keeps the key and its sign-in) and cancels
  every probe on stop — `mcp.login` / `mcp.testConnection` pushes go to the starting
  connection only (`ws.send`, not the broadcast topic) and foreign replies fail with `LOGIN_NOT_OWNER`; `session.list` decorates agent's `listSessions` summaries with
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
  A manual or automatic fix claims one in-memory per-item latch (`claimItemFix`) before its first
  await and holds it through package preparation and fix-send acceptance/failure, so overlapping
  manual sends are rejected. `isItemUnderActiveReview(sessionId, id)` surfaces both that latch and
  `planReviewQueue`'s active set to any caller that needs to know whether a review is in flight for
  an item.
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
  (so the panel shows the pulse the instant the client re-reads the plan) and deliver the outcome through
  the record + the Review tab. **Both** run the review body on the plan's serial chain
  (`planReviewQueue.onPlanChain` — the button path fire-and-forget, the tool path awaited), so a tool
  request never overlaps a button review of another step on the same plan. Both funnel into
  `recordVerdict`: `approve` settles the item (`approveTodoReview(…, "agent")`); `request_changes` files
  every finding into the Review tab (`fileFinding` — an inline comment when `reviews.anchorProblem`
  accepts the position, else review-level; anchor resolution is best-effort so a bad anchor falls back to
  a review-level comment, but a store-write failure propagates and cancels the review rather than silently
  dropping the finding while still spending the cycle) and then spends the fix budget.
  **The 1-cycle cap is the same on both paths.** `canAutoFix = reviewAutoFix !== false && spent < 1`
  (`todoReviewAutoCycles`), and the record is written with `autoCycles: canAutoFix ? 1 : 2` — `1` means
  "the worker was actually asked to fix, this item is mid-cycle", `2` is terminal ("the human decides
  now"). Recording `1` without asking anyone to fix would strand the item: `maybeAutoReReview`'s trigger
  reads exactly that value, and nothing would ever produce the fresh delta it waits for. **A cycle is spent only once the worker accepts the fix.** On the button path `deliverFixToWorker` owns
  the whole critical section — file the findings, record the optimistic cycle `1`, select and mark them
  `sent`, then send — with filing through mark held in one `withReviewLock` so no interleaved Review send
  can grab the just-filed drafts before reservation. Failure splits on whether filing completed: a *filing*
  failure throws before any record so the review cancels (`fileFindings` having compensated its partial
  persist), while any *post-filing* failure — a send rejection (worker detached, busy, pre-turn refusal)
  **or any preparation failure** (snapshot/package/mark) — re-records the item terminally (`autoCycles: 2`)
  on top of the optimistic `1`, alongside the `rollbackSend` that returns any marked findings to `draft`.
  A post-filing failure escaping as a throw would strand the item at `autoCycles: 1` — the whole point of
  the unified catch. Leaving `1` there would strand the step forever: nothing asked the worker to change anything, so
  no fresh delta can ever reach `maybeAutoReReview`, while a later manual review would read the cycle as
  spent and refuse to send. A claim the fix latch refuses (a manual Ask-to-fix already in flight) settles
  the same way. On the button
  path a live budget also **delivers the fix to the worker chat** (`deliverFixToWorker`): the item's
  origin-scoped draft findings (`itemFixFindings` — this item, this worker session, non-stale; an
  unscoped sweep would carry other steps' findings into this worker and strand them as falsely-sent) are
  rendered with `renderFixPackage` + `buildSendPackage` and sent as the structured `todo-review-fix`
  message under `ackSend`, with `rollbackSend` returning them to `draft` on a pre-turn rejection. The
  tool path never sends — the worker already has the verdict in its tool result, and a second copy as a
  message would double the instruction. With the budget spent or auto-fix off, both paths leave the
  findings in the Review tab for the user and say so (`composeText`).
  **One review at a time per plan** (`host/planReviewQueue.ts`): `onPlanChain` chains each run onto the
  plan's promise — `enqueuePlanReview` uses it for the detached button path, `handleRequestReview` awaits
  it for the tool path — so Review All starts N steps but runs them serially and a tool request queues
  behind an in-flight button review of a different step. N concurrent provider streams is what the chain
  exists to prevent. The same module holds the per-item claim both entry points check, so a step already
  under review is refused rather than reviewed twice with two verdicts racing onto one record. `todo.reviewAll` reports `{ total }` — the count it actually started — and `alreadyRunning`
  only when it started nothing while the plan's chain is still busy. The module is pure mechanics with an
  injected runner (no agent dep), which is also how `planReview.test.ts` drives the whole verdict →
  record → deliver path without a provider.
  **Auto re-review** (`maybeAutoReReview`, tee'd off the reconcile hook on `isTodoToolEnd`): after a fix
  lands and the worker re-marks the step done, exactly the items still inside their one auto cycle
  (`autoCycles === 1`, not `reviewing`, `status: "done"`) get re-reviewed. The trigger accepts either a
  fresh commit delta on a `changes_requested` record OR a record reset to `unreviewed` — the latter is
  the path-list fallback (`todos/artifacts.ts` drops the record when the redo can't be committed), where
  a surviving spent cycle is itself the "a fix landed" signal, there being no sha to watermark against.
  An eligible item is **enqueued onto the plan's serial chain even when another review is already running**
  (a fix landing while Review All reviews a different step), and the per-item claim dedupes — it must not be
  dropped when the chain is busy, or a step fixed mid-review would stay `changes_requested` at
  `autoCycles: 1` forever, since nothing retries once the chain drains.
  **An `approve` never settles an item that still has open findings.** The two rounds of a fix cycle are
  independent runs, so nothing structural connects round 2's approve to round 1's findings: the gate is
  explicit, `itemOpenFindings` checked before `approveTodoReview`. Its set is deliberately WIDER than the
  fix candidates — `itemFixFindings` is `draft`-only (a `sent` finding must not ride a second fix
  request), while the review model counts **both `draft` and `sent`** as unresolved, since a worker that
  fixed the code without calling `resolve_comment` left the finding open. Without the gate the plan reads
  ready-to-ship and Open PR lights up over a comment the Review panel still shows as blocking. The
  **inverse also holds, a `changes_requested` verdict must not outlive its findings:** both human paths
  that close a finding reconcile via `clearChangesRequestedIfResolved` — `review.commentDelete` (deletion)
  and `review.commentUpdate` (resolve/dismiss). When the closed finding was the item's LAST open one
  (`itemOpenFindings` empty) and the item is still `changes_requested`, its verdict record is dropped
  (`dropTodoReviewVerdict`) back to `unreviewed` — ONLY the record: an in-flight review's pending mark
  (its start-SHA watermark) and the auto-cycle count stay, so closing the last finding mid-review/fix can
  neither watermark commits the reviewer never saw nor reset the one-cycle cap; the check is a no-op while any finding stays open, so a
  whole-change verdict that never had an inline finding is never touched. The agent's `resolve_comment`
  path (`applyAgentResolution`) is deliberately NOT reconciled here — it lands inside a fix cycle whose
  following re-review re-derives the verdict, and the record is inert either way (the Open-PR gate counts
  open findings, not the record). The plan's review decoration is host-derived
  from that record and `apps/web`'s `useChatTodos` re-reads the plan on any review-snapshot change. A blocked
  approve clears the `reviewing` mark, leaves the record alone, tells the worker to `resolve_comment`
  what it addressed (`composeText`'s third shape) and rides the wire as
  `PlanReviewResult.blockedByOpenFindings` so the card cannot claim the step is done. `resolve_comment`
  stays the WORKER'S tool — `reviews.applyAgentResolution` only resolves a `sent` comment, and only when
  the calling session equals the chat `markCommentsSent` recorded it as delivered to;
  `project.trustSummary` answers the trust notice from agent's `projectTrustSummary(project.path)`;
  `project.setTrust`
  acknowledges the aliases present when it grants alias trust (agent's `listProjectAliasSkillNames`; a grant
  on an already alias-trusted project — the pi-level grant — keeps the acknowledged set, so aliases that
  arrived since stay pending review), sets the alias grant, grants pi-level trust only when the request carries
  `resources: true` (a revoke clears both; an older client's grant is alias-only), and hands the project's
  workspaces to agent's `applyPiResourceTrust` so live chats reload into the new trust (idle now, busy at
  settlement); `createServer` wires `setMcpPolicyResolver` (workspace → its project's `mcpApprovals` /
  `mcpOverrides` / `mcpToolGrants`, fail-closed to none) and `setMcpToolGrantWriter` (an "Always allow"
  answer → `grantProjectMcpTool` on the workspace's project) next to the admission resolver, and injects agent's
  `piTrustsProjectPath` as the projects trust seed
  (`setPiTrustSeed`), so a newly added project starts from pi's own decision; `project.acknowledgeSkills` / `project.setSkillEnabled` /
  `project.setGroupEnabled` / `project.aliasSkills` / `workspace.setSkillOverride` mutate/read the persisted
  toggles; `session.reloadResources` re-scans a running session — the composition stays here; `agent` never
  imports its sibling. `createServer` also wires **`setSkillAdmissionResolver`**, mapping a session's
  `workspaceId` → its project's trust/acknowledged/disabled + that workspace's overrides (fail-closed), so
  `agent` gates skills without importing `projects`/`workspaces`). The sibling subagent policy is composed
  here the same way: `createServer` wires `setSubagentsEnabledResolver` to map an explicit
  `Workspace.subagentsOverride` when present and otherwise use `AppConfig.subagentsEnabled` (unknown
  workspace fails closed), the settings
  publisher asks `refreshSubagentTools()` to reevaluate all live sessions after a global update that
  carries `subagentsEnabled` (likewise `refreshAgentReviewTool()` for `agentReviewEnabled`,
  `refreshSubagentConcurrency()` for `subagentMaxConcurrent`, `refreshExtensionTools()` for
  `disabledExtensions` or `extensionSettings`, and `refreshSkillAdmission()` for `otherAgentSkills`) — not after
  every publish, since `recentModels` now publishes on each model switch and a tool-set rebuild per idle
  session would be pure churn — and
  `workspace.setSubagentsOverride` persists through `workspaces` then refreshes only that workspace. The
  per-chat subagent limit composes identically: `setSubagentConcurrencyResolver` maps a valid
  `Workspace.subagentMaxConcurrentOverride`, else a valid `AppConfig.subagentMaxConcurrent`, else the
  contracts default (`resolveSubagentMaxConcurrent`; an unknown workspace uses the global value — a limit
  has no fail-closed meaning), and `workspace.setSubagentMaxConcurrent` persists then resizes only that
  workspace's service. Extension on/off is global only: `setDisabledExtensionsResolver` returns
  `AppConfig.disabledExtensions` as a set (unknown names are inert), `setExtensionSettingsResolver` returns
  `AppConfig.extensionSettings` the same way (cleared on shutdown), and `extension.list` answers with the
  `extensions` catalog joined with that same setting — the switch itself writes through `settings.update`,
  so there is no extension write method. **Installed pi packages** follow the same pattern one level up:
  `setDisabledPackagesResolver` returns `AppConfig.disabledPackages`, a change to either list calls
  `refreshExtensionTools()`, and `host/packages.ts` answers the `packages.*` methods by mapping an
  optional `workspaceId` onto the checkout plus a fresh project-trust thunk (`host/mcp.ts`'s shape) and
  delegating to the `agent` façade; a confirmed `packages.install` also drops the new identity from
  `disabledPackages` before returning the row, so a package the user re-installs is on. `packages.reveal`
  opens the catalog-validated folder (a single-file package's directory, never the file) through
  `revealInFileManager`. Boot primes the user settings file and every workspace record's
  `.pi/settings.json` for the packages watch (`primeUserPiSettings`, `primeProjectPiSettings`) and
  routes a `.pi/settings.json` workspace nudge to `handleProjectPiSettingsChanged` only for a project
  whose pi-level trust is granted — an untrusted repository's file never affects resolution, so it must
  not fan out a reload; a `disabledPackages` change also publishes `packages.changed` so a re-enabled
  row regains its chips. The channel is subscribed from `PI_PACKAGES_PROTOCOL_VERSION` and published
  through `setPiPackagesPublisher`. The
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
  `ackSend.ts` (the send-ack policy — see "Get right"); `titleTool.ts` (the **`set_title` host**, installed through agent's `setTitleToolHost` — the
  composition of `agent` + `workspaces` only the host may make). The main agent names things; the host
  only enforces the write policy (the old host-driven passes — first-words, then a cheap-model refine on
  the first settled turn, then a send-time cheap-model chat title — kept producing names users wanted to
  fix):
  - The calling session must be a live managed session (`getSessionWorkspaceId`); anything else — e.g. a
    subagent child — gets an error result.
  - `chat_title` → `renameSession(…, { onlyIfUnnamed: true })`. `workspace_name` → only when the workspace
    is managed (not `default`/`external`) and not `renamed`, via `renameWorkspace(id, name, { branch })`
    (locks the name; moves the branch only while the workspace is on its own branch, never an adopted one or a
    detached `HEAD`; when the branch is kept the name is still set and the result text says which branch
    was kept, why, and that a later call can still move it — see [[submodule-server-workspaces]]). A `renamed` record whose `branchNamePending`
    is this chat's session id accepts one more call with a `branch` (`branchMoveOwed`): the name stays, only
    the branch moves. Other chats get "already named". There is no branch-shape gate, so records an older host's
    provisional pass left unlocked are still nameable.
  - The result text states, per target, whether it was applied or kept because it was already named, so
    the agent stops. A `branch` without a usable `workspace_name` is rejected before any write (the slug
    would otherwise be silently dropped while the agent believes it is done). A call without a usable
    `workspace_name` while the workspace is still nameable is rejected the same way: a success result
    that asked the agent to "call again" was ignored live (Opus named the chat, then moved on), and one
    call keeps chat and workspace names in agreement. The first name is final, and a manual rename always wins.
  - `workspaceNeedsName(sessionId)` and the chat-only guard use one pure rule (managed and not `renamed`;
    an owed branch move never counts as unnamed and never re-prompts), so agent's
    turn-start `pending-naming` reminder and the write policy can't disagree.
  - A target the agent never names stays unnamed; there is no fallback.
  - `workspaceTools.ts` — the **workspace-tools host** (`setWorkspaceToolsHost`), composing `agent` +
    `projects` + `workspaces` + `git` for `start_workspace` / `workspace_status`:
    - A spawned workspace goes through the same background creation as the New Workspace dialog
      (`workspaces`' `createWorkspaceWithChat`, the kickoff carrying the prompt, images, model and effort,
      `origin: "agent"`): its creation row and progress show in every client while it runs, and
      `workspaceCreationHandoff` provisions the initial terminal, waits for `ensureWatch`, starts the chat
      through `chatSession.ts#startChatSession` and sends the prompt. The base is the dialog's default
      (`listBranches().defaultBranch` plus its prefetch — not the creation's checkout-HEAD fallback), the
      name an auto `workspace-N` that the child renames itself through `set_title`. The first prompt is
      plain text, so pi's own `/template` and `/skill:` expansion applies. The tool returns once the new
      chat's prompt passed pi's preflight, with the chat's model and effort from the hand-off's outcome
      (host-only; the `creationRemoved` push carries just `sessionId` / `kickoffError`).
    - Projects are the open repositories, matched by id, slug or name (default: the caller's). The
      Chats container is never one ([[submodule-server-workspaces]]): it is never resolved or listed,
      and its chats never match a named status lookup. A chat without a project has no default, so
      both tools refuse a call without `project` and list the open repositories.
      Attachments resolve against the caller's worktree: images ride as prompt images, and other files
      are listed by absolute path, because the child's worktree only has committed refs.
    - Project, model and attachments are validated **before** any worktree exists. If the chat fails to
      start, or does not take its prompt, after the worktree is created, the workspace is **kept** and the
      error names it (and its chat, once it exists). A creation that fails is discarded, not left as a
      failed row to retry: the agent got the error and decides. Like any creation it still fails
      visibly first — every client toasts the failure (and a hand-off's `kickoffError`), as it does for
      Continue in workspace's creation — because a workspace starting, or not, in the user's project is
      theirs to see even when an agent asked for it.
    - Stop cancels a start in progress: the signal kills the default-base prefetch, and a start stopped
      before the creation starts creates nothing; the creation's abort kills its git work and discards
      the record and anything it cut, and the tool says no workspace was created — or, when that
      cleanup cannot finish, that the partial workspace stays as an interrupted row to retry or dismiss. Once the hand-off runs, the workspace is registered and its chat starts
      regardless: the start completes and reports it.
    - An agent's spawn is not the user's explicit setup operation, so it records no `worktree_create`
      setup action ([[submodule-server-analytics]]); its chat still reports `chat_started`.
    - `origin: "agent"` (persisted on the creation record, so a hand-off replayed after a restart keeps
      it) makes the hand-off send through `ackSend` + `runObservation.send(…, "internal")` rather than
      `sendUserMessage`, and start the chat without the recent-model pick: an agent-sent prompt is not a
      user `message_sent`, never claims the feedback invitation, and its model is not the user's choice.
    - Status reuses existing state only: `listSessions` state (labelled working / needs_you / finished /
      failed / interrupted / idle), the cached `Workspace.review` (no new PR refresh), and diff stats.
      Start and status take their reads and effects as injected deps, so both are unit-tested without
      projects, worktrees or sessions.
  - The **workspace-archive teardown** — the other composition of `agent` + `terminal` + `workspaces` only
    the host may make. `workspace.remove` **rejects a `kind: "default"` workspace loudly, before any
    side-effect** (the record's `worktreePath` is the project folder — the reclaim's `rm -rf` fallback
    must never see it; the UI hides Remove, this guard is for buggy/rogue clients). It equally rejects,
    with `WORKSPACE_HAS_NESTED_WORKSPACES`, a managed workspace that still holds another workspace's
    folder (`nestedWorkspaces` — a project group's layout nests members inside an ancestor member's
    worktree, and the forced reclaim would delete them). Otherwise it
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
    a failed background teardown is warn-logged, never thrown into the void (nothing awaits it). **Archive keeps the branch but not the chat:** the git branch stays (code is
    recoverable), yet chat history is purged with the worktree — a deliberate scope choice, not a leak.
- **Change mutations are serialized per workspace, on their own chain** (`reviewLock.ts`'s
  `createKeyedLock` mints both): `change.revert`/`change.undo` run under **`withChangeLock(workspaceId)`**
  so two reverts cannot interleave their load→verify→write passes — and the Files tree's `fs.copy` (on the
  destination workspace) and `fs.delete` take the same chain, so a paste or delete never interleaves with
  a revert of the same worktree. `fs.delete` refuses a registered workspace root or any ancestor
  containing one with `WORKSPACE_HAS_NESTED_WORKSPACES`, comparing canonical paths with separator-aware
  containment; lifecycle protection stays composed here rather than inside `fs`. Reviews and changes —
  independent resources — never queue behind each other. The agent is deliberately **not** paused: the
  `changes` module's compare-and-swap and `fs`'s per-step identity checks (`ENTRY_CHANGED`) make the
  race safe, and the fs watcher's `fsChanged` tick re-reads
  the open tabs after a write exactly as it does after an agent edit (so both handlers `ensureWatch`
  first). `fs.copy`/`fs.delete` also publish their own invalidation on success through
  `watch.notifyWorkspacePathsChanged` (every path the copy wrote; a deleted folder as an unlisted subtree),
  because the watcher never reports `node_modules` or an unwatched gitignored folder. The named failures travel as `WsResponse.errorCode`
  (`STALE_VIEW`/`SCOPE_IMMUTABLE`/`RANGE_INVALID`/`RECEIPT_UNKNOWN`/`UNSUPPORTED_CHANGE`) through the same `CodedError`
  mapping `UNKNOWN_COMMIT` uses — the dispatch names no codes of its own, so a code added in `contracts`
  and thrown by a feature reaches the client with no host-side allowlist to update.
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
  path joins the same lock: accepted guide persistence and `deliverFixToWorker`'s
  file→record→select→render→mark pass stay under it, so a Clear cannot separate the guide from its
  findings and an interleaved send cannot grab the candidate ids between those stages. Approvals check
  open findings and record under that same lock; blocked or failed verdicts do not replace the guide. Deliberately unlocked: `review.get` (its load → re-anchor → persist is one synchronous pass,
  and hydration must not queue behind a send) — plus the two mutations that remain fully synchronous,
  `reviews.resolveCommentFromAgent` (the worker tool seam) and `reanchorWorkspace` (the fs-watch tee):
  both re-read the snapshot from disk before writing, and neither removes a comment nor closes the
  review, so landing in a send's gap can't invalidate the package's ids.
- **A review send lands in its explicit chat context, else the key's chat.** Both send
  handlers route through `sendToFileChat`: comments are grouped by `reviews.reviewSessionKey` (the
  anchor's path, or the review-level bucket for anchorless remarks — pinned like a file so a second
  overall remark continues one discussion), and each group lands, in order of preference, in the
  client's explicit chat context (the optional `sessionId` the send carries from a chat card), else
  the key's pinned chat (`reviews.fileReviewSession`), else a NEW chat; whatever
  received the package becomes the key's pin (`markCommentsSent`), so the sidebar's "open the
  discussion" always follows the comments. **A send that names its chat is one package**: when the client
  passes `sessionId` (a chat card's own chat) every comment goes into that chat in one
  structured message, because grouping exists to route each key to its own chat, and per-key packages into
  the same chat made the agent take one review — a before/after mockup's two files — in separate turns.
  **`review.sendBatch` answers with every session it touched**, in group
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
- **Host session creation:** `createHostSession.ts` owns the existing new-chat orchestration;
  `session.create` delegates through `startChatSession`, with projectless-chat recovery owning its claim. It reuses workspace lookup/scratch seeding, new-chat model
  resolution, agent creation, explicit-model recent history and chat-start analytics, without adding
  lifecycle or tool setup. After model resolution it re-reads the workspace and rejects a removed or
  replaced record (identity, project or path changed), for every caller. An optional synchronous guard
  runs before starting, after model resolution, immediately before agent creation and after creation
  resolves. A failed post-create guard does not delete or otherwise clean up the possibly-created
  session; the caller's pending marker owns that uncertainty.
- **Scratch-dir seeding on chat start:** the shared factory calls `ensureWorkspaceScratchDir` before
  creating the session, including Issue startup. The Default workspace's gitignored `.thinkrail/context/`
  lands in the user's repo only when a chat starts there; deleted scratch directories self-heal.
- **Background workspace creation (v111):** `workspace.startCreate` / `listCreations` / `retryCreation` /
  `dismissCreation` front `workspaces`' creation job, and `createServer` marks leftover running creations
  `interrupted` before it serves, installs the creation publisher (`workspace.creationChanged` /
  `workspace.creationRemoved`, subscribed only by v111+ sockets) and the **handoff**
  `workspaceCreationHandoff` (then replays any handoff a crash cut short): when a checkout finishes it provisions the initial terminal and, when the create
  carried a kickoff, waits for the workspace watcher (`ensureWatch`, the readiness the browser's own chat start
  awaits) and starts the chat through `startChatSession` (the kickoff's model/effort, else the saved defaults)
  and sends its text/images through `sendUserMessage` under the `clientKey` that started (or last retried) the
  creation, so the chat runs even with no window open — an agent's `start_workspace` creation
  (`origin: "agent"`) sends as internal instead (above). **The handoff waits only for pi's preflight, never the agent's turn:**
  `promptSession`'s `onPreflight` resolves once pi has validated the model and auth and started (or queued /
  handled) the run, so the creation is handed back — and its chat opened — within moments; a rejection
  before that point (no model, no API key) comes back as `kickoffError` beside the `sessionId`, and failures
  after it reach the chat through the session's own event stream. Waiting for the whole send ack (up to 10 s,
  or the entire first turn) kept the finished workspace on "Creating…" for that long. An empty kickoff starts
  the chat without a prompt, so the start surface always lands in a chat. The client key is remembered in memory only and dropped after the handoff or
  a successful dismiss. The host installs `projects`' path guard with `workspaces`' `creationOwnsPath`, so
  opening, initializing, creating or cloning a project at or inside a folder that is still being created is
  refused — a half-made worktree can never be adopted while its cleanup may still remove it.
  `workspace.create` stays a start-and-await over the same job (wire and e2e callers);
  its setup observation, like `startCreate`'s, wraps the whole job.
- **Project lifecycle fan-out:** `createServer` installs the `projects` module's publisher and maps every
  authoritative open/reopen/close snapshot to **`project.updated`**. The WS `open` handler subscribes to
  that channel and hydrates two views in `server.welcome`: `projects` (open records only) and
  `recentProjects` (all known records, with closed records whose folder is definitively
  gone omitted). The `/ws` upgrade first awaits `refreshRecentProjectFolders` for at most
  250 ms, so an unresponsive mount delays a connect by that budget at most and an unfinished check leaves
  its record at its last completed result; `open` itself never yields, so `server.welcome` stays the socket's first frame and
  both views are read from the current registry in the same tick they are sent. The one full-snapshot
  channel is idempotent and avoids separate opened/closed streams replaying out of order. Every client
  converges its rail + Recents from it; only
  the initiating open flow selects Project Home, while a close fallback remains per-client view state.
- **Workspace lifecycle fan-out:** `createServer` installs the `workspaces` module's publisher
  (`setWorkspacePublisher`), mapping each domain event `kind` → its `WS_CHANNELS.workspace*` channel
  (`created`/`updated` → the full record; `removed` → `{ projectId, id }`) and publishing it. This
  is the **single** place workspace membership changes reach the wire — create/rename/archive all flow
  through it, so every client (including the initiator) converges by reacting, never by per-client optimism.
  The two new channels are `ws.subscribe`d in the WS `open` handler alongside `workspace.updated`.
- **Session-deletion fan-out:** `createServer` installs the agent module's deletion publisher and
  broadcasts each workspace-scoped `SessionDeletedPayload` on `session.deleted`; the WS `open` handler
  subscribes every client so permanent domain deletion converges beyond the initiating page. It remains a
  low-latency event, not a durable queue: a reconnecting client's active-workspace `session.list` is the
  authoritative read-side repair for an event missed while its socket was down.
- **Chat Resources:** the scoped resource read, command output/stop and direct-child stop/stop-all
  handlers enforce each request's exact key set before resolving workspace membership and passing ids plus
  the registry-owned cwd to the agent barrel. Parent/child ids follow Pi's canonical session grammar
  (including internal dots); workspace and command ids retain their owner-specific grammar and authority.
  Missing parents/resources use `RESOURCE_UNAVAILABLE`; output's missing-command result is
  `available:false` only after validating its parent. No client path/PID field is accepted.
  The agent's resource publisher maps to `session.resourcesChanged`, subscribed in the WS open handler;
  this is a catalog invalidation, never an output broadcast. Resource ownership and teardown stay in agent.
- **Session-state composition:** before serving, the host supplies every workspace `{id,cwd}`, initializes
  lifecycle/receipt metadata, and installs the workspace→project resolver. `session.stateList` returns the
  complete all-workspace snapshot.
  - **Coalescing.** Concurrent requests share scans through `trailingSingleFlight`
    (`sessionStateList.ts`): a request never joins a scan that began before it arrived. Such a scan
    could miss a state change the page applied just before asking, and then overwrite it with an older
    record. Every request that arrives during a running scan shares the next one, so a reconnect storm
    costs at most the running scan plus one, never one full transcript scan per request.
  - **Old sockets.** The shared scan covers every workspace, and a socket that cannot see chats gets
    its records filtered by `isChatWorkspaceId`.

  `session.state` broadcasts full records (each carries the chat's `title`,
  so a rename while a client was away reaches it through the next snapshot); completion acknowledgement and
  nudge handlers validate workspace/session identity through the same registry. The WS open handler
  subscribes every client after welcome. `session.activityList` remains an inert `[]` compatibility method
  for one window and has no push channel.
- **CLI update lifecycle:** a launcher may supply one optional asynchronous notice producer, fixed interval,
  and parameterless update runner. `createServer` starts checks after listening without awaiting them and never
  overlaps checks. A newer release becomes the retained `available` snapshot in later welcomes. The v70
  `host.update` request acknowledges after starting one detached, server-single-flighted run; running,
  succeeded, and failed are full replacements on `host.updateAvailable` for every client. Success latches until
  host restart and does not shut down or relaunch the unsupervised process; failure permits retry and exposes no
  child output or arbitrary diagnostic. Discovery failures preserve known state, shutdown makes late results
  inert, and the host never learns feed, installer, command, path, channel, or version selection.
- **Survey invitation delivery:** the three user-send handlers share one post-`ackSend` path that
  filters control traffic once, tracks anonymous `message_sent`, and records the local feedback count. The
  feedback module's injected publisher maps an eligible claim to addressed `feedback.interview` delivery
  for that request's opaque client key only when its socket-advertised protocol version supports the channel;
  delivery failure or final client reap after the reconnect grace releases the claim, while a transient
  reconnect retains and re-delivers it after `server.welcome`. A host restart has no claim to re-deliver, and
  the welcome clears the frontend's stale popup projection. Popup `feedback.respond` actions are ordinary
  replay-safe requests and never alter the Settings link. A second injected publisher (`canAsk` + `ask`, both
  true only for a v103+ socket) sends the one-time star ask (`GithubStarAsk`, the star count the feedback module
  read) as addressed `feedback.githubStar` to the same client key.
- **Survey submission:** after `initializeAnalytics` the host configures the feedback survey source from
  analytics' `surveyEndpoint()`, so unkeyed, CI and test runs never fetch and `THINKRAIL_POSTHOG_HOST`
  applies. A source dev host fetches only when `THINKRAIL_DEV_POSTHOG=1` and `THINKRAIL_POSTHOG_PROJECT_KEY`
  are both set. `feedback.survey.submit` re-reads the survey list (no cache), refuses with `SURVEY_INVALID`,
  `SURVEY_UNAVAILABLE` (none launched, or already completed) or `SURVEY_CHANGED` (another id or
  iteration, or the translation the user saw is gone), hands the built payload to `captureSurveyResponse`, and records completion only when that
  capture is accepted (`SURVEY_NOT_SENT` otherwise, and when the list cannot be read). Once accepted the
  answer counts as sent: a failed completion write is logged, never reported as unsent, so a retry cannot
  send the answers twice.
- **Chat titles:** `session.rename` resolves `workspaceId` to its cwd and delegates title validation plus the
  unconditional durable write to `agent`; it never patches one client directly. Automatic titles come only
  from the agent's `set_title` (above); sends carry no naming work. Both manual and automatic
  writes converge every client through the existing `pi.event`/`session_info_changed` channel and the
  titled `session.state` record (see Session-state composition), with `session.list` repair; no new push
  channel exists.

- **Chats without a project (`chats.ts`, `gitCeiling.ts`):** `chat.create` makes the folder and record
  ([[submodule-server-workspaces]]), reserves the initial terminal and starts the one session the chat
  owns (host default model, or the dialog's explicit pick) in one call — a chat with no session yet (a
  crash between folder and session) gets it through `session.create`, which otherwise refuses a second
  top-level chat (`CHAT_HAS_SESSION`: a new chat is a new folder). **One lifecycle claim per chat**
  serializes its first session and its deletion: `chat.create`'s start and a recovery hold it, a
  recovery that finds a start in flight joins it (same session, real model and effort — the record is
  published before its session exists), and `chat.delete` takes it over — a start that has not reached
  the agent yet fails `CHAT_DELETING`, one that has is fenced by the agent's barrier below. `chat.delete`
  is the **only teardown door** (`session.delete` on a chat is refused): concurrent calls join; it marks
  the record `deletionPending` before anything destructive, then runs the Trash moves inside the agent's
  `closeWorkspaceSessions` barrier (admission closed, in-flight preparations drained, live sessions
  stopped and disposed, child cascades settled) — only then are the sessions listed, and each transcript
  goes through the agent's trash-based transaction (file by file, never the encoded directory), then the
  chat's delegated conversations (`trashWorkspaceDelegation`, the store to the Trash); then it
  closes terminals, stops the watcher, evicts the spec, review, change and turn sidecars, trashes the
  folder (only one under the chats root), drops the record and publishes the removal; a failure leaves
  the pending record visible with Retry. While a delete runs (`CHAT_DELETING`) or after one that did not
  finish (`CHAT_DELETION_PENDING`, persisted, so also after a restart) every door that would start or
  attach something in the chat refuses before dispatch (`CHAT_RESOURCE_DOORS`: `chat.continue`,
  `session.create`, `session.getMessages`, `session.nudge`, the session-resource reads and stops — they attach a persisted
  parent — `terminal.reserve`, `terminal.attach`), and initial-terminal provisioning skips the record.
  The host never sweeps unknown folders under the chats root. `chat.inspect` counts the folder's files
  for the confirmation as an **asynchronous, yielding walk** (`opendir`, so a directory-heavy scratch tree
  cannot stall the in-process host) within `CHAT_INSPECT_BUDGET` — entries visited, folders included,
  and wall time — answering `truncated` when either runs out; symlinks are counted, never followed, and
  ThinkRail's own `.thinkrail/context/.gitignore` scaffolding is not counted (an empty chat holds no
  files). Every repository door refuses a chat or the container at
  the handler (`REPOSITORY_ONLY_METHODS` — git, changes, reviews, pull requests, turns, diff stats and
  base, and the plan's review doors `todo.review` / `startReview` / `reviewAll` / `requestFix`, which
  would reach a git-backed review snapshot — plus project close/rename/trust/skills,
  `workspace.create`/`listExisting`, `git.listBranches`/`prefetch`); **the capability matrix of a chat
  is files, terminal and Plan, never git, review or specs**: `fs.readDir` lists a chat's folder without
  the git-ignore decoration, the `/blob` route answers 404 for a chat before any git, the
  Agent-review resolver handed to `agent` answers `false` for a chat (so its sessions get neither
  `request_review` nor its guideline), the specs resolver (`setSpecsEnabledResolver`) answers `false`
  for a chat too (its sessions and their children get no `spec_*` tool and no spec rule), `spec.graph`
  refuses a chat, and host search keeps a chat's root git-free and spec-free
  ([[submodule-server-search]]); the settled lifecycle, turn snapshots, plan artifacts, the plan's
  unattributed-change and adopted-commit reads, head recording and the setup funnel's `project_present`
  skip chats; and
  `applyGitCeiling()` merges `<dataDir>/chats` into `GIT_CEILING_DIRECTORIES` before the server exists
  (the root created first), so git, `gh`, PTYs and pi's bash inherit a ceiling that stops any walk up
  out of a chat folder into a repository that happens to enclose the data dir. The container is ensured
  at boot. **Older clients:** one visibility policy, `seesChats(protocolVersion)` (`chats.ts`), decides
  what a socket below `CHATS_PROTOCOL_VERSION` may learn — nothing of the container, its chats or their
  sessions. Its welcome, `project.list` and `session.stateList` omit them; `workspace.list` of the
  container answers `[]` and `session.list` of a chat answers as for an unknown workspace; `search.query`
  and `search.preview` hand the search service the audience, which drops the container (so its chats'
  records, files, plans and transcripts) from the corpora before any provider ranks or pages
  ([[submodule-server-search]]); `history.search` takes its hidden-cwd predicate from `historyHiddenCwd`,
  which holds every chat folder for such a client and, for every client, a chat whose deletion did not
  finish (its transcript may outlive a failed trash), so those transcripts are out of every scope, not
  just unlabelled. Every id-carrying push
  (`project.updated`, `workspace.*`, `session.*`, `terminal.tabs`, `workspace.fsChanged`,
  `turn.changed`, `mcp.status`, `session.resourcesChanged`, `pi.event`) goes through one
  `publishScoped` sender that leaves out the sockets that cannot see a chat or container id —
  `pi.event` is scoped by the workspace the agent publishes beside each event, so a detached session's
  disk-only rename is scoped like a live one's; `pi.extensionUi` for a chat session — live, or still starting
  (an extension's `session_start` notice, an MCP startup notice; `getSessionAttribution`) — goes only to
  sockets that both see chats and fall within the request's own audience (an MCP notice for clients below
  `MCP_PROTOCOL_VERSION` therefore reaches no socket for a chat); `recentProjects` never carries the
  container. Run analytics classify `workspace_kind: "chat"`.
- **Continue in workspace (`continuations.ts`):** one **in-memory** operation per user gesture and source
  chat (`chat.continue { workspaceId, projectId } → { operationId }`). A gesture for the same project
  joins the chat's operation while it is `requested`/`summarizing`/`creating`, and one still being
  admitted (the admission is reserved per source chat before its first await, so two windows on a chat
  whose session is only on disk get one operation); a gesture for another project meanwhile is refused
  (`CONTINUATION_IN_FLIGHT`), never silently folded into the first; after `started` or `failed` a gesture
  starts a new one. The host validates the source (a chat without a project holding a conversation — an
  empty chat has nothing to hand over; and open, per the chat lifecycle above: `chat.continue` is a chat
  resource door, and `assertChatOpen` runs again after every await before the session is attached or
  asked, so a delete that began or failed meanwhile refuses with `CHAT_DELETING` /
  `CHAT_DELETION_PENDING`) and the target (an open repository, never the container), publishes
  `requested`, then delivers a `continue-in-workspace-request` custom message to the source session as a
  **follow-up** (`sendHostMessageToSession` — a card in the transcript, queued behind a running turn,
  never a steer), moving to `summarizing`; the request's acceptance is awaited only for `REQUEST_ACK_MS`
  (a refusal before the turn fails the operation; the turn itself is not awaited). The agent answers
  through the `continue_in_workspace({ summary })` tool ([[submodule-server-agent]]). `applyContinuation`
  is **single-flight**: the operation's one apply promise is stored before its first await, and every
  later call for it — pi runs one response's tool calls in parallel — joins it and gets its result, so one
  gesture makes at most one workspace, chat, handoff and link. The apply revalidates the project, moves to
  `creating`, creates the workspace (default base) through `createWorkspace` — [[submodule-server-workspaces]]'s
  background creation, so its creation row shows in every client while it runs and the creation hand-off
  provisions the initial terminal — and records its id at once, then the chat (host default model, through `chatSession.ts#startChatSession`) and its id, then sends
  the `chat-handoff` custom message — the clamped summary plus a link back, the new chat's first turn and
  run ([[submodule-server-agent]]'s run boundary) — reporting `firstMessage: sent | failed` apart from the
  phase, remembers the link on the source record (`continuedTo` with the `operationId`,
  [[submodule-server-workspaces]]) and ends `started`. A failure after the workspace exists keeps its id:
  a new gesture for the same project inherits it while that workspace still exists in that project, so a
  same-host retry reuses it instead of leaving it empty, and a workspace removed in between is simply
  created again. Both swallowed failures (handoff delivery, the link) are logged with their error. A
  source run that settles without the call after the request reached the agent (`observeContinuation` on
  `agent_settled`, while `isHostMessagePending` no longer holds the request) fails the operation
  ("…without a summary"); a settlement before that — the previous run's, which pi finishes before it
  starts a deferred request's — waits for the request's own run. A request Stop drops from the queue
  (`onDropped`) fails the operation at once; a queue edit keeps it ([[submodule-server-agent]]). A host restart loses every binding, so the tool refuses;
  `chat.continuationStatus` answers a linked operation `started` from its `continuedTo` link and any other
  `CONTINUATION_UNKNOWN` (the client renders the card as `lost` and offers Retry); a restart while the
  workspace was being created also leaves that creation row interrupted, and its Retry builds a plain
  workspace — no chat, no `chat-handoff` message, no link. Phases travel on the
  scoped `chat.continuation` push (sockets ≥ `CONTINUATION_PROTOCOL_VERSION`, and only those that see
  chats); `chat.continuationStatus` answers a client that missed the pushes (a reload, a reconnect). Only
  the initiating client navigates — a web-side rule.
- **Search composition (`search.ts`):** `search.query` / `search.preview` / `search.text` go to one lazily
  created `SearchService` ([[submodule-server-search]]) fed with `listProjects`, `listAllWorkspaceRecords`, the
  history index's `sessions()`, `specSnapshot` and `listStoredPlans`, plus `listWorkspaces` (without diff
  stats) to provision a project's missing Default record and `ensureWatch(id, { prewarm: true })` to watch
  the root a query resolved, and `fs`'s `classifyBytes` as Find in Files' text check; a query carries no client state — the handler passes only the connection's
  audience (`{ chats: seesChats(protocolVersion) }`). `search.text` is the one stateful request: the
  handler passes the socket's `clientKey`, so the service supersedes an older `seq` and aborts the client's
  previous run; a closed socket cancels its run and a reaped client is forgotten. Find in Files' batches
  ride the **addressed** `search.textResults` push: `createServer` installs `setSearchTextPublisher`, which
  `ws.send`s each batch to the requesting `clientKey`'s socket only (sockets ≥
  `TEXT_SEARCH_PROTOCOL_VERSION`; a gone socket drops the batch, the terminal / MCP-login pattern). The
  `workspace.fsChanged` publisher also
  calls `invalidateRoot(worktreePath)` so a watched workspace's file list and spec snapshot refresh on the
  next keystroke. `fs.readFile` forwards `maxBytes` to `fs`.

**Artifacts wiring** ([[submodule-server-artifacts]]): the `workspace.fsChanged` publisher hands every
batch to `noteArtifactPathsChanged` (it reconciles when the batch is truncated or touches
`.thinkrail/context`, and recounts a recorded ignored output the batch reaches);
the session-event tee maps `agent_start`, `agent_settled`, `tool_execution_start` (tool call id, name and
args) and `tool_execution_end` (call id and name) into `observeArtifactSessionEvent`, and an `agent_start` also
`ensureWatch`es the workspace in watch's bounded **prewarm** tier, so a working agent nobody looks at is
watched without promoting its watcher for the host's lifetime (on Linux each watched worktree costs one
inotify watch per folder; background runs in big repositories would otherwise exhaust
`max_user_watches` for the workspace the user is looking at). The reconciles at every run start, tool end
and settle do not depend on it. `setArtifactsPublisher` fans
the index's change out as the pathless `workspace.artifactsChanged` nudge to v135+ sockets of that
workspace. `fs.delete`, `fs.rename` and `fs.move` run their mutation inside `withUserRemoval` (a move locks
both workspaces in id order), `fs.copy` and `fs.move` first call `prepareArtifactsDestination` for their
destination folder, and `workspace.remove` / `chat.delete` call `removeWorkspaceArtifacts` once the
workspace or chat record is gone.

`RunningServer.startAttributionClaim()` is the explicit launcher-readiness signal and rechecks the saved
enabled/confirmed choice before entering analytics attribution.

- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, `BootedHost`, `BuildKind`, `reportDesktopError`,
  `createIssueAgentSessionHost`, `IssueAgentSessionHost`, `IssueAgentSessionHostOptions`,
  `createIssueSessionStore`, `IssueSessionAssociation`, `IssueSessionStore`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, feature-introduction versions, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv` — for
  `boot.ts`; `codedError`; `paths` — the scratch-dir convention `chat.inspect` leaves uncounted); `persistence` (`dataDir` — where `crashLog.ts` writes); `pi-todos/core` (reduced synchronous
  task snapshots, with group status still core-owned); the feature modules it composes (per the parent dependency graph, incl. `fs`'s
  `resolveWorktreeFile`/`resourceMeta` and `git`'s `readBlobStreamAtAsync` for the `/files` + `/blob`
  routes, `fonts`' `fontFileKind`/`saveUserFont` for `/fonts/`); Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`.

- **Settled-lifecycle wiring (`settledLifecycle.ts`).** The host is where the three activity sources meet the
  `workspaces` writers: the normalized session-state publisher stamps `recordWorkspaceActivity(record.workspaceId)`
  whenever a record reports `execution: "running"` (a user prompt flips it, so both user and agent turns
  count — and the writer's one-per-minute coalescing makes a streaming agent cheap), an accepted
  `terminal.write` stamps the owning workspace (a displaced/no-op write does not), and the repo-metadata
  callback calls `recordWorkspaceHead`, with `watch`'s watch-started nudge wired to `seedWorkspaceHead` so
  first admission seeds and watcher recreation detects a HEAD move made while unwatched. Reading a result, selecting a workspace, or opening
  files never stamps — "looking is not working" is the user-visible rule. `workspace.settle` /
  `workspace.unsettle` are thin handlers over the module; settling never touches disk, and
  `workspace.remove` stays the only teardown. Starting `pr.open` itself stamps activity before its first
  await (opening a PR is work, so it reactivates a parked row) and persists any returned PR against the
  exact post-dirty-read branch reported by `openPr` (then strips that host-only context from the wire), so
  an external checkout switch during the mutation can neither drop nor misattach the created PR; accepting
  a button/auto plan review stamps activity synchronously too. **Review refresh:** after a
  `workspace.list` reply and on a five-minute timer the host refreshes the `review` snapshot of the rows
  whose PR state can still change the partition — live rows on every pass, **idle-settled rows at most
  every 30 minutes** (a PR opened for a dormant branch from outside ThinkRail must still bring it back,
  but dormant branches are the long tail and must stay cheap), and never rows parked by the user (the
  override wins regardless) or a merged/closed snapshot with a valid terminal time (an incomplete settled
  answer remains live and refreshable; a reopened complete review is caught on activation) — bounded to a
  few concurrent provider calls and riding the module's 60 s cache. Idle refresh pacing is branch-aware,
  so switching branches never inherits the old branch's 30-minute delay; a fresh
  `workspace.openReview` or `workspace.branchStatus` for the active workspace also writes the snapshot, so the
  active row is always current. Both writers pass the branch the lookup was made for, and `workspaces` drops an answer whose
  branch has moved underneath it. All three go through `findWorkspaceReviewOutcome`, which **never looks up
  a review while a workspace of any kind sits on its base branch** (`pr`'s `onBaseBranch`): `gh pr list
  --head main` matches any fork's `main` and would mark the row settled with a foreign PR. It answers a
  reliable `null`, so a foreign snapshot stored earlier is cleared. **Protocol skew:** `RequestContext.protocolVersion` is the socket's
  advertised protocol (absent for in-process callers, who speak the current one); `workspace.openReview`
  (and `workspace.branchStatus`, whose callers are always newer) answers a client older than `WORKSPACE_SETTLE_PROTOCOL_VERSION` with `null` for a merged or closed
  review, because such a client reads any review as an open PR and its plan pane would offer *Push
  updates* that creates a new PR — the host snapshot itself still records the true state. **Branch status / push / generate (v87):**
  `workspace.branchStatus` composes the same review lookup + divergence as `openReview` with `git`'s
  `commitsAheadOf` (ahead of the base), `pr`'s `onBaseBranch`, and the provider of origin's push URL (`originUrls`, as `pr.open` reads it); for an
  origin whose push URL differs from its fetch URL the divergence is `countPushTargetDivergence` against the
  push repository, so the counts describe the repository the Push action delivers to — `published` is the divergence answer itself (its remote ref exists), so the two never disagree; when
  the measurement fails it falls back to the tracking ref only for a single-URL origin, and a split origin
  reports `published: null` (unknown) rather than the fetch repository's answer; `workspace.push` stamps activity
  like `pr.open` and drops the worktree's review cache through `pr`; `pr.generate` is composed here —
  `pr` gathers the bounded input (`prDraftInput`), `assist` drafts — so `pr` gains no `assist` edge. **Review
  actions (v88):** `pr.ready` / `pr.merge` / `pr.reopen` / `workspace.deleteRemoteBranch` delegate to `pr` and
  stamp activity like a push; the snapshot follows on the client's next fresh `workspace.branchStatus`
  (a merged review needs the provider's merge time, which only the lookup has). `skipFetch` on
  `workspace.branchStatus` skips only the origin fetch, never the review lookup. **Backfill:**
  the same post-list pass gives records without `lastActiveAt` their
  stamp from the newest chat's `updatedAt` (`listSessions`), else the worktree's `.git` gitfile mtime
  (managed and external worktrees alike — only the Default row, whose `.git` is the repository itself,
  skips to now), through `backfillWorkspaceActivity` — once per record, since the stamp then exists.
  Per-row backfill/review failures are logged and detached list/timer passes always catch their terminal
  rejection; lifecycle maintenance may degrade, but can never become an unhandled host-fatal promise.

## Get right

- Every registered WS command is debug-traced by **method name only** (`ws <method>` / `ws <method>
  failed`); a name absent from the closed handler registry is traced as fixed `ws unknown method` instead.
  Never trace raw unregistered method names, params, or handler error text, which can reflect credentials
  and user-supplied values; see `submodule-server-log`'s privacy rule.
- WS commands return values directly; only events + extension-UI + **`project.updated`** (published from
  the `projects` module's injected publisher) + the workspace lifecycle trio
  (`workspace.created`/`updated`/`removed`, published from the `workspaces` module's injected publisher) +
  the creation pair (`workspace.creationChanged`/`creationRemoved`, from its creation publisher) +
  **`session.deleted`** (published from the agent module's injected publisher) + **`provider.changed`**
  (published from auth's Central/runtime invalidation seam and on a successful provider login) + **`host.updateAvailable`** (published for each
  retained CLI-update lifecycle replacement) use push channels. Every
  **broadcast** push channel a client should hear must be `ws.subscribe`d in the WS
  `open` handler — the push sender skips a socket that is not subscribed, silently. Six channels are deliberately
  **not** subscribed and not broadcast: `feedback.interview`, `feedback.githubStar`, `terminal.data`, `terminal.exit`,
  `terminal.detached` and `search.textResults` are sent with `ws.send` to one addressed client. Adding an addressed channel means
  wiring a publisher, not a subscription.
- **Terminal backpressure never trusts the `drain` event alone.** A backpressured `ws.send` latches the
  client in `terminalBackpressured` and blocks its batchers, and the batcher deliberately retries only on
  `resume()` — so the latch's lift must be guaranteed. Bun's `drain` is the fast path, but a drain lost
  across a system sleep (observed after a macOS hibernate) left the latch set forever: the tab frozen,
  the pty alive, the recorder still current. A 1s reconciler asks the socket itself: with the flag set,
  `getBufferedAmount() === 0` means the drain the OS never delivered (`drainedClientKeys` in
  `terminalSend.ts`), so the host lifts the latch and resumes that client's terminals. A socket with
  buffered bytes stays latched, and a latch whose socket is already gone is left to `close`/`open`.
  Reloading the client always recovered (open clears the flag and resumes), which is why this hid so long.
- **The composer's image budget stays under the inbound frame cap, never the other way round.** Bun
  closes a socket on a frame over `maxPayloadLength` before any handler sees it, taking every open
  request with it, and the client replayed that frame on every reconnect (#671). `maxPayloadLength` is
  `WS_MAX_FRAME_BYTES` (16 MiB, [[module-contracts]]); the 12 MiB `REQUEST_IMAGE_BASE64_BUDGET` leaves
  room under it for the prompt text, and `WsTransport.request` refuses a larger frame before it is sent
  ([[submodule-web-transport]]). Raising the cap instead was tried and rejected: pi echoes a prompt's
  images back through `pi.event` several times, multiplying the outbound volume against the buffer limit
  below (#1179, #1180); providers also reject a whole request near 20 MB.
- **The outbound buffer limit is 256 MiB (`WS_OUTBOUND_BUFFER_LIMIT_BYTES`), well above any reconnect
  resync.**
  - **The default and the failure.** uWS checks the buffered amount *before* each send. Under Bun's
    16 MiB default, a reply over 16 MiB (a screenshot-heavy `session.getMessages`, 39 MB) was accepted,
    and the next send returned `0`, meaning dropped. The reply path reads `0` as a dead socket and
    closes. The page then re-read every mounted transcript on reconnect (`useTranscriptSync`), and the
    same big reply closed the socket again. That loop ran for hours, with every welcome stacking
    another full `session.stateList` scan until each one was abandoned.
  - **Past the limit, the socket is quarantined, then closed.** Every reply and push goes through
    `sendOrQuarantine` (`socketSend.ts`).
    - **On a drop.** A frame refused with `0` on an open socket warns once, with the method or channel and
      the buffered bytes. The warning carries a `SlowConsumerError` (`WS_SLOW_CONSUMER`), so Error
      Tracking counts how often it happens. From then on nothing more is sent to that socket: replies,
      pushes and terminal output are all held back. `-1` means buffered, and is never resent or closed.
    - **Closing.** `settleSlowConsumer` closes the socket gracefully once its buffer is empty, from
      Bun's `drain` or the 1 s reconciler. If it has not drained 30 s after the drop
      (`SLOW_CONSUMER_DRAIN_DEADLINE_MS`), it `terminate`s the socket instead. The page then replays
      its unresolved ids and re-hydrates (Decision 8). A transcript that was streaming repairs at its
      settlement, as after any reconnect.
    - **Why not close at once.** Closing at once was tried and rejected in review. Bun runs the
      `close` handler, and so starts the 60 s replay reap, the moment `close()` is called. A drain
      that keeps making progress resets uWS's own close timeout, and `terminate()` after `close()` is
      a no-op. A probe reader taking 64 KiB every 250 ms kept a closed socket open for 33 s. So a tab
      draining for over 60 s reconnected after its replay results were gone, and a running
      folder-picker request ran twice.
    - **Test-only seam.** `outboundBufferLimitBytes` on `createServer` lowers the limit for the wire
      test only.
  - **`closeOnBackpressureLimit` is rejected.** It closes with 1006 and discards the buffered frame:
    a probe client received 0 frames.
  - **Why finite, why this value.** Memory grows only while a client reads slower than the host writes,
    up to the limit per socket. A limit of `0` (unlimited) would let one slow client exhaust the host.
    A resync larger than 256 MiB brings the loop back. Since #1180 image bytes leave the socket
    (`WireImage` references), so a transcript's size is its text. The limit still covers the
    composer-restore replies that hand images back inline.
  - **Pushes are sent per socket, never by `server.publish` (#1179).** A native topic publish cannot
    name the socket that dropped a frame, and for a frame under 16 KiB it reports the status from
    before uWS drains its queue. So a burst of small pushes could cross the limit, lose its tail
    (`agent_settled` included) and leave the tab streaming forever while it kept talking to the host.
    `publishScoped` and
    `pi.extensionUi`'s audience filter share one `fanOut` loop: subscription, then the socket filter,
    then `sendOrQuarantine`. A test rejects any `.publish(` call in the server source. Addressed sends
    (search results, MCP login, feedback asks) use the same rule. The terminal publisher keeps its
    own latch and treats a quarantined socket as unavailable.
- **A backpressured socket gets stream snapshots conflated, not dropped (#1179).**
  - **Why.** Streaming is O(n²) on the wire: each `message_update` and `tool_execution_update` repeats
    the whole response or output so far. Without conflation, a slow tab piles that up until
    quarantine.
  - **What is held.** `HeldSnapshots` (`heldSnapshots.ts`) lives on the socket's `SocketData`. It
    applies after subscription and audience admission. While `getBufferedAmount() > 0`, it keeps the
    newest serialized frame per session's assistant message or tool call, instead of sending it. The
    frame is serialized once per publication. Host observers still see every event.
  - **Barrier.** Before a later frame of the same session (a non-snapshot Pi event, `session.state`,
    or `pi.extensionUi`), it sends that session's held frames synchronously. It keeps going through
    `-1` (accepted) and stops only if the socket is quarantined. A held frame is therefore exactly a
    delayed send.
  - **Flushing in a pause.** Bun's `drain` fires on writable progress, not on an empty buffer: a
    probe saw it fire repeatedly with tens of MiB still buffered. So `drain` and the 1 s reconciler
    flush held frames only at `getBufferedAmount() === 0`. A flush that hits backpressure stops
    there. A drain that leaves held frames waiting or backpressured does not lift the terminal latch
    either, so continuous terminal output cannot keep the buffer from ever emptying
    (`terminalsMayResume`).
  - **Clearing.** Held frames clear on close or replacement, on `session.deleted`, and on quarantine:
    a quarantined socket takes no new snapshot, and the reconciler clears what it held. They never
    carry over to a reconnect.
  - **Rejected.** Assistant `message_end` does not discard a held partial. A mid-stream client that
    missed `message_start` needs that partial to create the turn; `message_end` alone renders nothing.
    Stateless skipping was rejected too, because a tool that goes quiet would show stale output until
    it ends. Dropping held frames at the next session boundary was rejected for the same reason.
  - **Bound.** One frame per pending stream key; there is no byte budget. Quarantine stays the safety
    net for everything else.
- The host is the single place features are wired together — features never reach back into it.
- **A font upload must carry `X-ThinkRail-Request: font-upload`** (`USER_FONT_UPLOAD_HEADER`), else 403.
  The host has no auth, no Origin check and no CORS ([[architecture]] Decision 7). A cross-origin upload
  needs a CORS preflight — by the `PUT` method, and by this non-simple header whatever the method — which
  the route answers 405 with no `Access-Control-*` headers, so another website's write never leaves the
  browser; the same-origin client needs no preflight. Never add CORS headers to `/fonts/`, and keep the
  header check should the route ever accept a simple method such as `POST`. It is the host's only HTTP
  write because the alternatives fail the feature: base64 over the WebSocket hits the 16 MiB frame cap
  (CJK fonts run past 20 MB) and a pending frame is replayed on every reconnect, and the host's native
  file dialog cannot take a drag-and-drop and opens on the host's screen, not a remote browser's.
- **Login-shell environment import is opt-in at boot** (`resolveShellEnv: true`, passed by the dev,
  CLI and desktop launchers). Post-mortem: with it on by default, `boot.test.ts` copied the developer's
  login environment — provider API keys included — into the shared `bun test` process (`bun test`
  drops `TERM=dumb`, so the terminal guard never fired). Later faux-model suites then resolved a real
  provider, timed out, and hung the server suite while spending real tokens. Any embedder or test that
  does not pass the flag keeps the environment it was given.
- Separate host processes do not coordinate mutable state or events. They may use the same data directory,
  but each owns independent in-memory sessions, terminals, watchers, and connected clients; persistence
  conflicts are accepted rather than serialized by the host.
- `shutdown()` is safe under concurrent signal/native-quit calls: callers receive one promise, lifecycle
  work runs once, and resource disposal remains ordered after session settling and turn-receipt draining.
- **A send (prompt/steer/followUp/respondToTool) is acked when ACCEPTED, not when the turn ends**
  (`ackSend`): pi's send methods resolve only at turn end, and a turn can outlive the client's request
  timeout (long tool rounds and multi-minute reasoning turns are routine) — awaiting completion would
  surface a phantom "request timed out" over a healthy turn. A rejection inside the ack window still fails the request (bad
  model / missing key; for `respondToTool` also an unknown/responded/superseded call —
  `assessRespondability`'s loud verdicts, or a response without a value); later faults reach the client
  via the event stream.

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

Preserving the *original* reviewed code was considered and rejected: reconstructing it after the
fact from `reviewedSha` is unsound (the finding's textQuote came from the add-time worktree, which is not
guaranteed to equal that blob), and add-time snapshotting is real storage cost for low value (a finding
whose code was overwritten is usually moot; its prose body survives regardless). If ever needed, the only
sound route is snapshot-at-add, never freeze-on-drift.

### Persisted delta (whole phase)

One optional persisted `ReviewComment` field carries finding provenance: `origin?: { todoId, reviewedSha,
sessionId }` — **landed**. The wire `stale?: boolean` is derived by the host per client snapshot, never
stored. No new tool parameter, no new `status`/`anchorState` enum value.


## Issue detail read (v114)

`issues.detail` accepts the exact shared `IssueTarget`, checks local project membership (not trust),
restores the host-owned connection, and delegates complete reads to the Issues service. The dispatcher
refuses clients below `ISSUES_DETAIL_PROTOCOL_VERSION = 114` before delegation. No caller credentials,
paths, actor, workflow version or remote mutation are accepted.

## Issues read composition (v103)

`issues.ts` lazily creates the public issues service for `issues.connection`, `issues.connect`,
`issues.disconnect`, and `issues.list`. The separate v113 `issues.content` read validates an exact
`IssueTarget` and local project membership without requiring trust, restores the connection, then
projects the service's binding-checked body and verified web URL. It reads no comments, session or
workflow state, and performs no writes. Clients below `ISSUES_CONTENT_PROTOCOL_VERSION` are refused
before delegation. The adapter validates unknown params itself (exact request
keys, nonblank local project id, and the contracts connection-input guard with exact input keys),
because the dispatcher only casts (the connection input may carry only an exact-instance
`httpConsent`). It checks repository membership through `projects.getProjects`, rejecting `kind: "chats"` before
service initialization, connection or credential writes, and requires **no** project trust:
connecting is the user's own explicit address+token entry, not repo-defined code, and a plain repository
offers no trust affordance at all. The v104/v106 stage actions stay trust-gated because they touch the
worktree, git and remote state. `issues.connect` is gated at the v105 Issues auth protocol; the other
read/connection RPCs keep the v103 floor. Connection metadata and disconnect remain available without
trust so a user can inspect or release an existing credential. These are read/connection RPCs only:
no stage actions, generic credential framework, or agent/session injection.

### Association address hint (v105)

`issues.repositoryAddress({ projectId })` also sits at the v105 Issues auth floor with
`issues.connect`, because it prefills the form that will carry a token. The call takes no path:
the exact-key request guard accepts only `projectId`, and the host resolves the registered project
through `getProjects`, requiring membership and `trusted === true` like connect/list. It then runs the
existing bounded local `git` read `originUrls(project.path)`: no fetch, no `ls-remote`, no credential
helper, no network. The host answers the configured `origin` fetch URL only when the project has a
single remote named `origin` and the value is already a credential-free canonical HTTP(S) address
(`canonicalIssueInstanceUrl`); it is returned as git spells it minus trailing slashes so the web
resolver owns the instance/project split. SSH/SCP, userinfo, query/fragment, no-origin,
multiple-remote, and unreadable repositories all answer `{ repositoryUrl: null }`, and a git failure
is never surfaced: errors are the existing static `CodedError` messages and never echo git output or
a token. `PROTOCOL_VERSION` stays at the auth floor; no new capability flag is introduced.

The lazy initialization promise is shared; a failed load clears it so a repaired binding file can be
retried. The adapter owns `<dataDir>/issue-bindings.json`: only local project id, HTTPS instance URL,
and canonical remote project id are stored, never token or connected state. A missing file means no
bindings; malformed/extra-key rows fail closed with the service's fixed load error. Each upsert
synchronously rereads and merges the latest file, writes a unique same-directory temporary file, then
renames it atomically and removes temporary debris. This non-yielding critical section prevents lost
updates across adapter instances in one process; it is not a cross-process lock. The file also carries
only credential metadata: optional UUID `credentialId`, an exact canonical HTTP acknowledgment, and bounded
cleanup UUIDs. Disconnect stops local use immediately, awaits an in-flight connect/restore, commits a record
with no active credential, deletes those vault entries and resolves only after deletion; failure rejects and
leaves runtime restoration blocked for retry. The public binding survives.

A connection or list request lazily calls the service's `restore`, which reads only the active vault
credential and re-verifies the numeric project within the existing deadline. A project without a stored
credential stays metadata-only and never touches the vault. Startup performs no vault read and no network request; there is no retry loop. Action
composition restores before acquiring its remote capability so durable credentials work after restart.

The token exists only in the injected OS-vault primitive and transient process memory for authenticated
reads; it must not be persisted in JSON, logged, returned, or attached to error causes. The production
adapter (`Bun.secrets`, Windows machine-local) scopes vault names to the host data directory and has no
plaintext fallback; tests inject a disposable store. Host ingress logs only the
registered method; existing classifier-only reporting and the service's fixed credential-safe errors
remain authoritative. Existing replay behavior is unchanged: a SHA-256 payload fingerprint (not raw
params) and serialized credential-free response are retained. A replay of a completed connect or
disconnect returns its original response, not current connection state; clients must query
`issues.connection` for current state and use a new request id for a fresh operation. Transport must
be appropriately protected: this composition does not introduce authentication or encryption.

### Host-only Issue credential primitive

`issueCredentials.ts` exposes `createIssueCredentials({ namespace, secrets?, platform? })`
with lazy OS-vault `get(credentialId)`, `set(credentialId, token)`, and `delete(credentialId)`
operations via `Bun.secrets`, under the dedicated `ThinkRailIssues` service. The future host
composition must supply its canonical data-directory identity as the namespace, identical across
restarts of one profile and distinct across profiles. The primitive does not resolve paths or
canonicalize namespaces; it rejects blank, control-bearing, or over-4096-character namespaces.
Account names are `v1-` plus SHA-256 of the JSON tuple `[namespace, credentialId]`, exposing
neither value in vault metadata. IDs must be canonical lowercase UUIDv4 strings, allocated by
the service for each credential generation, not derived from a project/remote binding. Separate
IDs isolate pending/current generations so rollback or cleanup of one cannot overwrite or delete
another; setting the same ID still replaces that generation's value. There is no binding-object API.
Tokens are nonblank printable ASCII, at most 4096 characters, preserved byte-for-byte (never trimmed).
Only trusted host `get` returns a token; sets/deletes return no secret or public metadata.
Windows writes request `persist: "local"`; other platforms omit that Windows-only flag.
All invalid input, malformed vault results, and vault failures become a fixed
`CodedError("RESOURCE_UNAVAILABLE")` without raw errors, causes, or logging. There is no
fallback to environment, memory, or JSON. Import/factory creation performs no vault operation;
tests inject disposable backends and platforms and never access the real vault.

This primitive is deliberately **not wired** into the current memory-only connection service.
Its `get`/`set`/`delete` surface is intended for a future injected `IssueCredentialStore` port,
not a service dependency today. It does not allocate IDs, implement connect verification,
binding/vault transactionality, rollback, concurrent connect/disconnect ordering, reconnect, or
credential lifecycle policy. Service-owned generation allocation and host-owned canonical namespace
composition remain required integration constraints before the existing lifecycle above changes.

### Durable issue workflow receipts

`issueWorkflowPersistence.ts` implements the Issues `WorkflowPersistence` port independently of the
connection adapter. The caller supplies an existing, privately owned storage directory. Each reference
is strictly bounded and canonicalized (HTTPS URL, canonical numeric remote project id, positive IID),
then keyed by SHA-256 of the JSON tuple `[provider, canonical instance URL, project id, IID]`.
Records are credential-free, exact-shape validated, bounded JSON envelopes binding that reference to
one revision. Receipt publication bodies, versions and implementation commit/design bindings must agree.
A pending reservation names exactly one of `publish-design`, `publish-implementation`, `approve-design`,
`approve-implementation` or `start-implementation`, and its version must match that operation's stage:
a design digest for the three design-bound operations (including `start-implementation`, the version the
user approved) and an implementation digest for the two implementation ones.

Per-reference immutable `1.json`, `2.json`, … files are the journal. Exclusive `wx` creation of the
next revision is the cross-process CAS claim, not rename or a process-local lock. Every file must be
contiguous from 1 and valid; missing, torn, malformed, oversized or unexpected entries fail closed.
A competing writer seeing a reserved/incomplete file must stop, never skip it. Nothing is overwritten,
removed, replayed or taken over after a timeout. A lost CAS returns false only for a valid competing
revision; corrupt/uncertain storage throws a static reconciliation error. No recovery policy is supplied.

Success requires file fsync and close. Directory fsync is also required where supported; Windows
unsupported directory-open/fsync errors are tolerated because Node/Bun cannot portably flush Windows
directory metadata. Thus Windows guarantees a flushed file, not power-loss durability of its directory
entry; a lost tail after power loss cannot be detected by this journal alone. The caller owns durable
provisioning of the root directory. Filesystem/hardware fsync and exclusive-create semantics must be
reliable (local storage; network filesystem guarantees are not asserted). This seam is composed with the server-only actions below, not new wire handlers.

### Durable Issue workspace launches

`issueWorkspacePersistence.ts` exports `createIssueWorkspacePersistence(root)` for an existing private
local directory. `withLaunch(localProjectId, reference, operation, beforeRelease?, failurePolicy?)` acquires and flushes an exclusive
`wx` fence for `(localProjectId, IID)` before invoking the callback, which must wrap the entire
process-local Issue workspace coordinator operation. Different remote bindings contend for the same
numeric destination. A fence names its owning `pid`, and an existing one is reconciled only by
provable death of that owner (`ESRCH`), never by waiting, timeout or a guess: a fence written by an
older build without a `pid` records no owner that could still be running and is reconciled the same
way. A live owner, an unreadable or foreign fence, and a fence describing another key keep blocking.
The default `retain-on-failure` policy preserves the fence on callback, storage or guard errors for
non-launch operations, including approval and publication. Design/implementation launches and the low-side-effect `repositories` / `setRepositories` operations explicitly
use `release-on-settle`: once their awaited operation actually settles, success or failure releases
only the fence that call acquired, without clearing ownership, session-pending or startup records.
A release failure reports `ISSUE_LAUNCH_RELEASE_FAILED`, never a safe-to-retry claim. Contention reports
`ISSUE_LAUNCH_BLOCKED`; old live-owner fences remain unverifiable and are not blindly removed.
The optional synchronous `beforeRelease` guard runs after successful write/directory flushes,
immediately before unlink; rejection still releases a launch-policy fence but rejects the result. Successful unlink is the explicit release commit point: no fallible
operation follows it that could report a committed launch as failed. Fence deletion is not directory-fsynced and is not claimed durable
against power loss; a crash may retain or reintroduce the fence, safely blocking future launches until
reconciliation rather than replaying uncertain work. Retained callback ports cannot operate after completion.

Records use the full local-project/provider/instance/remote-project/IID key, checked exactly on every
load/save. Bounded exact shapes validate ownership, design associations, pending/completed worktrees,
sessions and pending session creation; unknown/torn records halt with a static reconciliation error.
Optional repository selections and auxiliary ownership members follow [[submodule-server-issues]];
the adapter validates their ordered project identity and each member's pending/completed ownership,
rejecting auxiliary session fields. Old records omit both fields without a write-time migration.
Records carry no design or implementation version: a completed association holds only
`{workspaceId, worktreePath, branch, session: {id}}` and a pending session creation only
`{stage, workspaceId}`, so re-entry reuses the recorded session and compares no version.
Records contain only credential-free reference and workspace metadata. Saves snapshot validated input
and atomically replace records using an exclusive own temporary file, file fsync and rename, followed
by directory fsync. Only owned temporary files and fences eligible under their operation policy are removed;
there is no rollback or automatic reconciliation. Directory fsync is best effort on Windows for the
same unsupported/permission errors as the workflow receipt adapter. Durability relies on trusted local
storage honoring file flush, rename and exclusive creation; network filesystems are outside this
contract. This adapter does not compose host handlers, authenticate a binding, or perform Git/session
operations itself.


### Issue actions (v104)

Design and implementation launches require only the provider-neutral read capability. GitLab-only
workflow capabilities are resolved lazily by the workflow methods that use them, never as a prerequisite
for launching either stage. Both providers use the same workspace/session coordinator and startup path.

`createIssuesHost` composes `issuesActions.ts` with the **same lazy IssuesService** as connection/list.
Its closed methods are `launchDesign`, `launchImplementation`, `publishDesign`,
`publishImplementation`, `validateDesign`, `validateImplementation`, plus the v106 `approveDesign` /
`approveImplementation` and v108 `startImplementation` below. All accept exact
`{projectId, reference}` targets; implementation
launch/publication additionally require a bounded `approvedDesignVersion`, and design publication
requires bounded `expectedDescription` and `newDescription`. Nested references have exact keys,
canonical HTTPS instance and numeric remote project identity. Caller paths, workspace/session ids, commits and arbitrary actions are rejected
before side effects. Named bound exports from `issues.ts` register exactly these methods under
`issues.*` in the typed dispatcher. `withIssuesActionsProtocol` rejects versions below
`ISSUES_ACTIONS_PROTOCOL_VERSION = 104` before delegation with `RESOURCE_UNAVAILABLE` and the static,
input-free message "Issue actions are unavailable for this protocol version." Undefined protocol
versions remain permitted for in-process callers, matching the existing wrapper convention.
Read/connection methods retain their v103 gate. Wire types do not replace unknown-input validation
in the action methods; credentials are never added to responses or errors. `apps/web/src/issues`
dispatches only `issues.launchDesign` and the v108 `issues.startImplementation` below, under
`supportsIssueActions`/`supportsIssueImplementation`; publication, validation and approval stay
host-side. No merge, push or merge-request mutation is introduced.

#### App-originated approval (v106)

`approveDesign` and `approveImplementation` are the same closed actions for app-originated approval
and are registered at the v106 approval floor. `withIssuesApprovalProtocol` rejects versions below
`ISSUES_APPROVAL_PROTOCOL_VERSION = 106` before delegation with `RESOURCE_UNAVAILABLE` and the
static, input-free message "Issue approvals are unavailable for this protocol version."; older v104
action and v103/105 read gates are unchanged, and undefined protocol versions remain permitted for
in-process callers. Both accept only the exact `{projectId, reference}` `IssueTarget`: caller paths,
workspace/session ids, commits, versions, actor ids, roles and tokens are rejected before side
effects, and the host derives the actor from its own `currentUser` wrapper. They reuse the same
trust/capability guards, point-in-time fence `beforeRelease`, `withLaunch` wrapper, wrapped
`WorkflowRemote` (including that `currentUser` wrapper) and lazy IssuesService as the other actions,
and they never take a caller SHA: an implementation approval reads HEAD through the same
`ownedImplementation` + `resolveCommitOid` port used by publication. Each approval writes exactly one
remote approval label record and leaves a durable workflow receipt; it does not create a note,
merge request, push or merge, and it is not merge authorization. The Issues panel dispatches neither:
an in-app approval is a separate decision from starting implementation.

Each operation requires a current explicitly trusted project and an exact live `remoteFor` capability.
The host captures client identity and rechecks it and the project path/trust before and after every
injected await, remote dispatch, persistence, workspace and session port, except the committed fence
release. Its final capability/ownership guard runs synchronously in `beforeRelease`, not after the
fulfilled `withLaunch`: authorization is point-in-time at release, not perpetual. Capability changes
after successful unlink return committed success; retries reuse the saved association rather than
receiving a misleading reconciliation failure. Each of the seven
WorkflowRemote methods is explicitly wrapped; a previously captured raw client cannot bypass later
disconnect/reconnect or binding changes. Trust/connection preflight precedes persistence/fencing.
The host provisions separate private `issue-workflow` and `issue-workspaces` directories under the
configured dir/dataDir, rejecting symlink/junction directories and ancestors. Durable workflow receipts
remain canonical per remote reference. The workspace adapter's cross-process `withLaunch` fence
covers the entire action, including workflow work, with one coordinator constructed inside its
callback; failures retain uncertainty for explicit reconciliation, never automatic retries.

Server-only `repositories` / `setRepositories` actions use the same full-identity launch fence and
strict selection DTOs. Saving requires open trusted member projects. Launch pins their source paths and
rechecks availability/trust around every awaited port.

**Project groups.** `project.scanGroup` / `project.importGroup` delegate to `projects`
(`scanProjectGroup` / `importProjectGroup`). For Issue actions the host supplies the coordinator's
`references` port from `groupReferenceCandidates` — the primary's open, **trusted** other group members
(untrusted members are never offered, since joining never grants trust), at most 64 — each as its
Default workspace id and main project path. `groupWorkspaceLayout` answers the `layout` port only when
every listed participant is in the primary's group and still sits at its recorded relative place under
the real group root, and then also places every other open member found at its place; it returns null
(ordinary per-repository paths) in every other case. The group folder is a plain folder in the usual
(`repo`/`west`-style) layout and is never required to be a repository; when it happens to be one, it is an
ordinary member, and `workspaces` excludes `/.worktrees/` in that repository either way.

**Project group home (v127).** `project.groupStatus`, `project.fetchGroup` and `project.removeGroup`
sit behind `PROJECT_GROUP_HOME_PROTOCOL_VERSION`. `projectGroupHome.ts` composes them over
`projects.projectGroupProjects`: status runs one `git --no-optional-locks status --porcelain=v2
--branch` per open member (10 s budget, at most six at once; local refs only, so ahead/behind are as of
the last fetch, and an untracked folder that is or holds another member is the group layout, not a
change); Issues come from `issuesHost.groupIssueRecords` (implementations whose primary is a member,
read-only like the rail bindings, any reconciliation failure yields none, each carrying the title the
host last saw in an `issues.list`/`issues.detail` answer — an in-memory, bounded cache, so a title
appears once the Issues tool has listed since host start). Each Issue repository with a worktree is
measured there with local refs only: one `status --porcelain=v2 --branch --untracked-files=all`
(changed paths, minus folders that are this Issue's nested worktrees; the branch's own upstream), the
start commit — a joined member's recorded `base`, else for the primary (which records none) the oldest
reflog entry of its Issue branch (the `worktree add -b` creation, kept only while still an ancestor of
HEAD), else the merge-base with the default branch — and `rev-list --count` for `ahead` (start..HEAD)
and `behind` (HEAD..default branch: `origin/HEAD`, else `origin/main`/`origin/master`, else the main
checkout's branch). `changed` is `ahead > 0` or any changed path. Fetch runs `git fetch --all
--no-tags --quiet` under the default non-interactive env (no ssh rewrite, per the `git` SPEC) with a
30 s budget per repository, skips a repository without remotes, and reports each outcome with git's
redacted stderr. Remove delegates to `projects.removeProjectGroup` and never touches disk.

**On-demand joins (v126).** `issues.addRepository` (`IssueRepositoryJoinInput`) and
`issues.cleanupRepositories` (`IssueTarget` → `IssueRepositoriesCleanup`) run under the same launch
fence with the `release-on-settle` policy, behind `ISSUES_REPOSITORY_JOIN_PROTOCOL_VERSION`. The joining
project must be open and trusted like a saved selection, and is pinned with it. `baseRef` is
`freshBaseRef`: with an `origin` remote it fetches that remote's default branch (non-interactive env,
`BatchMode` SSH unless the user set `GIT_SSH_COMMAND`, 30 s deadline, failure ignored) and returns
`origin/<default>` when that ref exists, else undefined (local HEAD). `memberUnchanged` is
`worktreeUnchanged` (`rev-list <base>..HEAD` empty and `status --porcelain --untracked-files=all`
empty; ignored build output does not count and is discarded). `removeMember` re-checks that and the
`nestedWorkspaces` guard, awaits the full workspace-archive teardown (`setIssueWorkspaceArchiver`, which
`handlers` registers with the same teardown `workspace.remove` uses), then deletes the reserved branch
only while its tip is contained in `base`. A successful join re-announces the new workspace so the rail
tag converges. The bound `issue_join_repository` tool reaches the same join through
`IssueAgentSessionHost.joinCandidate` / `joinRepository`: only an implementation-stage binding may ask,
only for a repository its current contexts list as `reference`, and the tool obtains the user's
confirmation through the session's UI `confirm` dialog before the host joins anything.

They are registered as `issues.repositories` (read) and `issues.setRepositories` (write whole selection)
behind `ISSUES_REPOSITORIES_PROTOCOL_VERSION` = v115, with the same static credential-free gate wording
and no caller-supplied path, credential or workspace authority. `workspace.list` decorates each row with
the host-owned `Workspace.issue` binding — primary or associated, with whether the primary has
associates — derived from owned implementation records (the single ownership source) by a best-effort
directory scan; no worktree, session or remote is read, and an invalid record is skipped rather than
failing the rail. The binding is never inferred from a branch name.
Workspace lookup spans only the primary plus explicitly selected source projects, retaining each
member's project identity. `projectPath` resolves the requested member rather than the primary.

Issue startup and bound context reads obtain stage-specific repository projections through the same
coordinator: design uses source Default workspaces, implementation verifies fixed owned members.
Initial provider-context preflight precedes all preparation; final startup context is read again after
worktrees are ready, with their actual paths. Context resolution is supplied explicitly inside a launch
fence to avoid recursively acquiring it. Bound `issue_context` refreshes via a new fenced lookup.

Workspace ports use project-constrained `listWorkspaceRecords`, authoritative `listGitWorktrees`,
exact-branch creation and `listWorkspaces({includeDiffStats:false})` for Default. Design launches create/reuse Default sessions without worktrees and use bound Issue startup. Implementation launches use the
coordinator's ownership ports without a workflow readiness check or design receipt. The recorded
session is reused for every re-entry; no version is compared and no workflow label is written.
Session reuse uses agent's nonprompting `sessionReuseStatus`; creation delegates to the existing
`createHostSession({workspaceId}, guard)` helper. Only those two session functions have optional
factory-scoped test substitution, not an alternate lifecycle.

Implementation publication derives its own full commit SHA: lookup-only `ownedImplementation`
runs on that same coordinator/fence, followed by `git.resolveCommitOid(worktreePath, "HEAD")` and
another ownership check. Workspace id, path and branch are pinned across all current-commit reads in
the action. The workflow repeatedly invokes this port around publication and implementation approval;
a stale receipt cannot authorize a changed checkout HEAD. No recursive `withLaunch`, caller SHA,
worktree adoption, push, MR, merge or CI capability is introduced.

#### Implementation start (v108)

`issues.implementationRecovery` and `issues.recoverImplementation` (v134) expose a read-only, credential-free recovery diagnosis and an explicit snapshot-bound implementation restart. Eligibility requires every selected member's checkout, Git registration, and workspace registration to be absent with no pending side effect. The execution repeats the diagnosis inside the existing launch fence and preserves the old branch/session ownership before preparing new checkouts. `issues.implementationHistory` reads only recorded session ids from archived Issue transcript files and never attaches them. Ordinary `workspace.remove` keeps its existing transcript purge policy; Issue-bound removal uses the agent's transcript-preserving archive port and a path lifecycle barrier.

`issues.startImplementation({ projectId, reference })` → `IssueSessionLaunch` is the one action behind the
confirmed implementation button. It is registered at the v108 implementation floor:
`withIssuesImplementationProtocol` rejects versions below
`ISSUES_IMPLEMENTATION_PROTOCOL_VERSION = 108` before delegation with `RESOURCE_UNAVAILABLE` and the
static, input-free message "Issue implementation starts are unavailable for this protocol version.";
undefined protocol versions remain permitted for in-process callers, and the earlier v103/104/105/106/107
gates are unchanged. It accepts only the exact `IssueTarget`; a caller-supplied design version, stage,
path, actor, workspace/session id or token is rejected by the same validators.

The action runs inside the same trust/capability guards, `withLaunch` fence and wrapped
`WorkflowRemote` as the other actions and performs exactly two ordered steps under that one fence:
`issues.startImplementation` dispatches directly to `coordinator.implementation(reference)` inside
the same trust/capability and whole-operation fence. It creates/reuses `.worktrees/issue-<IID>` without
reading design receipts or mutating GitLab labels. The v104 legacy method validates its old request
shape but also uses this version-free coordinator. No confirmation dialog or readiness port remains.

#### Approved-design read (v107)

`issues.designApproval({ projectId, reference })` → `IssueDesignApproval` is the credential-free
approved-design read. It was introduced for the older implementation-launch contract that required the
exact `design:<sha256>` digest; the v108 start gate above no longer consumes it, so it stays available
without being part of the panel's implementation path. It is registered at the v107 design-approval floor: `withIssuesDesignApprovalProtocol` rejects versions
below `ISSUES_DESIGN_APPROVAL_PROTOCOL_VERSION = 107` before delegation with `RESOURCE_UNAVAILABLE`
and the static, input-free message "Issue design approvals are unavailable for this protocol
version.", and it passes `ctx.protocolVersion` to `issues.designApproval(params, protocolVersion?)`,
which repeats that same static floor for direct callers. Undefined protocol versions remain permitted
for in-process callers, and the v103/104/105/106 gates are unchanged.

The host adapter (`issues.ts`) accepts only the exact `{projectId, reference}` `IssueTarget` through
the contracts guard — caller versions, paths, actor ids, commits and tokens are rejected with the
static `RANGE_INVALID` "Invalid Issue request." before any read — requires project membership through
`getProjects` but **no** project trust, and reads the **same** receipt store the actions write:
`createIssueWorkflowPersistence` over `<dataDir>/issue-workflow`. It never creates or repairs that
store (an absent directory is simply no receipt), performs no credential restore, no vault read, no
network request and no git read, and returns `{ approvedDesignVersion }` only when the reference's
design receipt exists, is `approved === true`, has no `pending` reservation and holds its validated
publication version; every other case — missing receipt, unapproved, pending, malformed or
unreconciled store — answers `{ approvedDesignVersion: null }` or the adapter's existing static
reconciliation error. Implementation receipts are never consulted or exposed, so an approved
implementation cannot stand in for a design approval. The answer is only that digest: no note id,
body, commit, token or other receipt field crosses the wire, and failures remain the adapter's static
`CodedError` messages rather than raw store contents.

### Durable Issue session associations and once-only publication

`issueSessions.ts` exports `createIssueSessionStore(root)`. This is a standalone host-owned,
credential-free metadata namespace, not a credential store or agent adapter. The root must already
exist on trusted, privately owned local storage; it is not created or discovered by this service.
No session enumeration API, network access, vault access, agent calls or logs are provided; the
stage lookup above reads only the store's own bindings.
`bind(association)` durably fixes sessionId, workspaceId, local projectId, remote Issue reference,
stage (`design|implementation`) and effective canonical BCP-47 locale (never `system`). Identical
canonical identities are idempotent; every ownership/context change fails closed. `get(sessionId)`
returns that association or null for an absent session. `findAssociation({projectId, reference,
stage, workspaceId})` returns the one binding that matches all four, null when none does, and stops
when two do: it is the coordinator's only evidence that an interrupted launch had already created its
session. IDs are bounded safe opaque identifiers
(including UUIDs and test identifiers such as `session`); references are exact, bounded GitLab
HTTP(S) references without credentials/query/fragment, canonicalized before comparison.

A SHA-256 session-id directory contains immutable, exclusive-created `bind.json`,
`startup.pending`, `startup.completed`, and contiguous numbered summary `.intent`/`.completed`
pairs. All accessed metadata must be regular files, never symlinks; roots/session directories
must be real directories. Exact-shape bounded JSON is revalidated on reads, with no secret fields
accepted. This assumes trusted ancestors and no hostile concurrent filesystem replacement.
`reserveStartup(sessionId)` flushes an exclusive intent before returning true; callers must reserve
before agent dispatch and invoke `completeStartup` only after the initial message is accepted.
A valid completion takes precedence and makes reservation return false; any uncompleted intent,
even torn or empty, requires explicit reconciliation. The service never dispatches that message.

`recordSummary(sessionId, operationId, body, send)` flushes an exclusive intent containing the body's
SHA-256 digest before invoking `send` exactly once. The callback returns a positive safe-integer
confirmed note ID. A flushed completion stores only the digest, operation/session identity and note
ID, not the raw summary body. The same completed operation/body returns its note ID without another
send; changed bodies and invalid journal tails stop. Unresolved publication raises
`ISSUE_SUMMARY_RECOVERY_REQUIRED`. The existing summary call accepts optional `reconcile` recovery:
it requires the original operation ID/body and fresh complete bound remote notes, and completes only
from one exact body/SHA-256 match with a real positive note ID unused by other receipts. Zero or
multiple matches never send. Legacy intents are eligible for read-only reconciliation across restarts.

Both recovery enum values represent mandatory explicit HUMAN confirmation, not an inference by an
agent. For `reconcile`, the human confirms adopting the matching receipt: exact-body matching does
not prove the original author (the remote model supplies no authorship evidence).
`retry-confirmed-unpublished` confirms that the original request/process ended, remote publication
did not happen, and the human authorizes retry. Absence, local errors and timeouts are NOT such
confirmation. This implementation authorization is not authorization to reset live state.
Legacy intents without extra markers are eligible under that same explicit confirmation contract.
Retry requires zero fresh exact matches and exclusive/flushed `.retry` audit/fence creation before
one send. No `.failed` marker is needed: callback failure alone proves neither remote nonpublication
nor termination; independent human confirmation supplies the prerequisite instead. One recovery send
per intent is allowed; uncertainty after it can only be reconciled to a published note. Retry markers
contain the same session/operation/digest identity, not bodies or credentials. No automatic replay,
timeout takeover, invented IDs, deletion or overwrite exists. Concurrent completions accept only the
identical receipt. Bodies (128 KiB UTF-8), records (16 KiB) and operations (1,000/session) remain bounded.
Exclusive `wx` intent/retry creation arbitrates across processes. Remote reads are observations, not
compare-and-swap; callers must not assert confirmation for an in-flight original request. The host
cannot independently verify human confirmation; the enum carries it through the existing tool.

Immutable exclusive files deliberately replace rename-based replacement: rename could overwrite a
competitor's claim. Success requires file fsync/close and directory/root flush where supported;
readers independently flush complete records before trusting them. As with workflow persistence,
Windows unsupported directory-open/fsync errors are tolerated: file bytes are flushed, but portable
power-loss durability of directory entries is not promised. Reliable local exclusive-create/fsync
semantics and durable root provisioning belong to the caller. This section introduces no wiring,
agent behavior or UI surface.


### Bound Issue agent composition

`issueAgentSessions.ts` exports injected `createIssueAgentSessionHost` and host/options types;
`issueSessions.ts` exports `IssueSessionStore`. `createIssuesHost` composes both with the same lazy
IssuesService, trusted project and managed workspace lookup. The private `<dataDir>/issue-sessions`
root is provisioned lazily before session creation. Server composition installs context/summary
callbacks with `setIssueToolHost` after session services are available and clears them on shutdown.
No credential crosses this seam. The new v109 `issues.beginDesign` and
`issues.beginImplementation` actions require the exact `IssueSessionStartupTarget` (including its
effective locale) and are gated independently at `ISSUES_SESSION_STARTUP_PROTOCOL_VERSION`.

Only a new begin action prefetches the issue and complete notes and builds
`createIssueStartupPrompt`, before the coordinator can create a worktree. Only a session actually
created by that coordinator call is bound to the Issue and eligible for one startup prompt. Reused
sessions, including legacy sessions with no association, return their IDs without rebinding or sending.
The locale comes from the request, never the host preference. Legacy `launchDesign`,
`launchImplementation`, and `startImplementation` retain their empty-session behavior and never
associate or autostart. Newly created legacy and begin sessions use the guarded Issue title; reused
sessions are never renamed. Binding is durably stored before the coordinator stores its launch association;
only after both writes does the host reserve startup, send once, and record acceptance. Uncertain
startup retains its independent durable prevention of duplicate dispatch. Failed launches release their
workspace launch fence only after actual settlement. The workspace launch fence covers the entire
awaited operation, including context reads, resource creation and startup acceptance; no detached
resource creation may outlive it. The browser's 60-second request deadline abandons waiting, not host
execution or the lock. Provider fetch/body deadlines abort the read and reject before subsequent
creation; a late read result has no continuation into workspace/session creation. There is no general
launch cancellation deadline: a still-running creation retains mutual exclusion until it settles. Prefetch on a reused begin is permitted, but never causes a subsequent send.

`issue_context` requires a durable association, current trust, matching workspace ownership and live
exact remote capability. Every call fetches a fresh issue, complete paginated notes and verified remote
project path and returns the bounded untrusted-data startup projection, never cached context.
`issue_record_summary` validates a nonblank 32,000 UTF-8 byte body and caller-generated operation ID
matching the tool's 1–128 ASCII alphanumeric/dot/underscore/colon/hyphen contract. The store binds that
ID and exact body digest to the session before one authenticated note write. Confirmed retries return
only the note ID; changed bodies or uncertain writes require reconciliation. Trust, project path,
workspace path and remote identity are checked around asynchronous work. No automatic turn-end
publication exists: the skill and startup prompt require confirmed summary publication before handoff.
