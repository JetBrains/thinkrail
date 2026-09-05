---
id: submodule-web-transport
type: submodule-design
status: active
title: transport — WS client to the host
parent: module-web
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The single WebSocket client to the host, its app-wide singleton, and the ordered delivery boundary that
batches high-frequency Pi events without allowing later wire messages to overtake them.

## Boundary

- **Owns:** `transport.ts` (`WsTransport`: id-correlated `request` — replies time out after 60s unless the
  caller raises `timeoutMs`, which a request the host answers *only once a human has* must do (an open
  folder dialog: a fired timeout also drops the reply that follows it) —, the **`?client=` page identity** and
  **`?protocol=` current wire version** it appends to the socket URL (the identity is minted lazily and *not*
  via the secure-context-only `crypto.randomUUID`, so a plain-http remote origin still boots; it spans
  reconnects but not reloads, correlating replayed requests and terminal stream routing while host-owned PTY
  tabs/shells survive and a reloaded page takes them over by durable `tabKey`; the version lets a newer host
  avoid claiming an addressed feature for an independently shipped older client that cannot render it), **reconnect-safe unresolved requests** — a
  frame that was in flight when its socket died returns to the queue and is replayed under the same request id,
  while the host deduplicates `(clientKey, requestId)`, so an accepted mutation cannot become a false failure or
  execute twice —, the two frames that are this side's half of that bargain — **`{ ack: [id] }` receipts**
  (every response read is acknowledged, batched on a microtask; until one arrives the host must assume the reply
  died with the socket and keep it replayable) and the **`{ resume: [ids] }` reconciliation** sent on every
  (re)connect *before* the replays (the complete still-unresolved set, so the host releases everything else).
  Receipts are deliberately best-effort and never retransmitted — one can die in a socket buffer exactly like a
  response can, and the request it named is already gone from `pending`, so nothing would replay or re-ack it;
  `resume` repairs them all at once by restating the truth rather than confirming the confirmations —, channel
  `subscribe` with last-value replay for snapshots; append-only terminal data and the one-shot terminal
  exit/detach + session-creation/deletion + `provider.changed` invalidation + addressed `feedback.interview`
  channels are never cached or replayed to late subscribers, reconnect/backoff;
  `inferUrl` defaults to
  same-origin; **`httpBase()`** derives the host's HTTP origin
  from the WS `url` — for building host HTTP URLs like the `/files/<workspaceId>/<path>` worktree-file
  endpoint the markdown viewer points relative `<img>`s at, targeting the same host the transport dials); `piEventBatcher.ts`
  (the browser-side bounded queue for consecutive `pi.event` frames: exact arrival order, no dropped events,
  one atomic delivery at roughly 30 Hz, a 128-event forced-flush ceiling, and `flush`/`dispose` lifecycle);
  `wireTransport.ts` (`initTransport`/
  `getTransport` singleton; routes `server.welcome`, **`project.updated`**, `pi.event`, `pi.extensionUi`,
  **`session.created`**, **`session.deleted`**, **`provider.changed`**, addressed **`feedback.interview`**, **the
  `workspace.created`/`updated`/`removed` lifecycle trio, and `workspace.fsChanged`** into the store — and
  folds every connection transition through
  `setStatus`, whose connected generation gives active-workspace hydration a distinct trigger on every
  reconnect; the complete welcome (protocol + open/recent project views + optional config) via the atomic
  `installWelcomeSnapshot`, whose separate `welcomeGeneration` is the cold-navigation readiness edge; after
  every welcome it re-reads each project whose workspace list this surface already holds with
  `includeDiffStats: false`, generation-fencing the result and folding only already-known rows through
  `updateWorkspace`, so a pushed full workspace snapshot missed while disconnected (including a rename)
  cannot stay stale without misrepresenting this metadata repair as membership reconciliation;
  project snapshots via `applyProjectUpdated`, consecutive `pi.event` frames through the batcher into one
  `handlePiEvents(payloads)` store commit, `pi.extensionUi` via `applyExtUi(request)`,
  `workspace.created` via `addWorkspace(workspace)`, `workspace.updated` via `updateWorkspace(workspace)`,
  `workspace.removed` via `applyWorkspaceRemoved(projectId, id)`, `session.created` via `noteClosedChats`
  (peer-created domain state enters history only, never local placement), `session.deleted` via the idempotent
  `deleteChat(workspaceId, sessionId)` tombstone fold (an online fast path; because this event channel is
  deliberately not replayed, workbench hydration repairs any deletion missed while disconnected from the next
  authoritative `session.list`), **`session.activity`** via `applySessionActivity(payload)`,
  `provider.changed` via the atomic store invalidation
  `noteProviderChanged()` plus a `model.list` re-read installed through the store's monotonic provider-version
  guard (the model-catalog hook uses the same guarded write for every list/refresh, so an older reply cannot
  restore a removed generation's models; provider settings observes the same version and re-reads
  `provider.status`), each valid `server.welcome` first clearing any popup projection left by a host restart,
  then `feedback.interview` via the idempotent `showInterviewPrompt()` (a surviving host claim re-delivers the
  addressed event immediately after welcome),
  `workspace.fsChanged` via `noteFsChanged(payload)`, and **`settings.changed`** via `applyConfig(config)` — the post-startup server-synced app config broadcast;
  welcome config lands in the atomic install above.

  **Activity hydrates on welcome, and retires there too.** Alongside the workspace re-read, every welcome
  runs `session.activityList` → `hydrateSessionActivity(rows)` under the same connection-generation fence,
  because `session.activity` pushes are never replayed and a reconnecting surface would otherwise render a
  rail from before the outage.

  A generation fence alone is **not** enough, because the collision is *within* one connection:
  `activityHydration` therefore **buffers pushes for the duration of the read** and replays them, in
  arrival order, immediately after the snapshot installs. Without it a push that lands while the request is
  in flight is silently reverted by a snapshot the host computed before it — leaving a wrong glyph until
  that session next changes. Same shape as the Pi-event batcher above: the transport owns push *ordering*,
  the store stays a plain fold. Reads are tokenized so a stale response cannot settle over a newer one; a
  **failed** read still replays its buffer (no snapshot arrived, so those pushes are the only truth left),
  while a **superseded generation** discards it (a fresh welcome is already re-reading, and replaying a
  dead connection's pushes would resurrect stale rows). Both settle *and* failure are generation-fenced for
  that reason — `WsTransport` **resends** pending requests across a reconnect, so an outcome can arrive
  after the connection it was issued on is gone.

  The unsupported-welcome path additionally **abandons** any in-flight hydration before clearing, and that
  ordering is load-bearing: a v60 read can be in flight with pushes buffered when the endpoint reconnects
  to a pre-activity host, whose rejection of the resent `session.activityList` would otherwise replay those
  pushes *after* the clear — stranding a glyph the older host can never retract. `abandon` invalidates the
  read's token, so its late settle or failure is inert. The capability gate is **`supportsSessionActivity(protocolVersion)`**
  (`ACTIVITY_PROTOCOL_VERSION`), and failing it does **not** skip the call: it hydrates `[]`, so a surface
  that has seen a newer host and then reconnects to an older one clears its glyphs rather than stranding
  them — that host can send neither a snapshot nor a retraction. Store semantics for the fold live in
  [[submodule-web-store]]; the wire shape is [[module-contracts]]. Before `WsTransport` dispatches any response or non-Pi
  push, `wireTransport` flushes queued Pi events synchronously; connection-status transitions do the same.
  This dispatch barrier preserves cross-message order and the store's transcript-revision fence while still
  collapsing consecutive stream frames. All subscriptions happen once at init, never in component effects);
  `errorText.ts` (**`errorText(err, fallback?)`** — normalizes a rejected `request` (the host's error
  string / a timeout / a thrown non-Error) into a short, display-ready line for an error turn/notice);
  `requestError.ts` (**`RequestError`** + **`wsErrorCode(err)`** — a rejection that carries the host's named
  `WsResponse.errorCode`. A coded response rejects with a `RequestError`, everything else (timeout or an unnamed
  host error) with a plain `Error`, so *having* a code is exactly how a caller tells "this
  specific failure" from "the read failed"); `skillLoad.ts` (the one app-integration coordinator for session
  resource loads: single-flight `workspace.watchReady` per workspace; unless the watcher was already known
  ready, fold the conservative `skillChange: "unknown"` wildcard locally as a replay-safe fallback; capture
  the store tick only afterward. Its narrow `prewarmWorkspaceSkillLoad` entry lets a workspace navigator start
  that same preparation before selection without duplicating readiness/fallback policy; failures remain
  retryable by the eventual load. A prewarm preparation is flagged on the wire (`prewarm: true` — the host
  keeps prewarm-only watchers in a bounded, evictable pool) and **never becomes a real load's baseline**:
  the first real load always runs its own real-flagged preparation — answered instantly while the watcher is
  still warm, and re-creating/promoting it (fresh conservative nudge included) when it was evicted — so an
  evicted prewarm can never leave a session on a stale freshness baseline, while prewarms freely ride any
  in-flight preparation and a settled prewarm re-issues (re-warming an evicted watcher on project
  re-selection stays cheap). The wrappers then issue `session.create` / `session.getMessages` /
  `session.reloadResources`, so no call site can accidentally reverse readiness and baseline ordering. The
  `session.getMessages` wrapper also rejects unless the returned summary exactly matches both requested
  workspace and session, making that untrusted-response identity check one shared installation boundary rather
  than a caller convention).
- **Public surface (barrel):** `initTransport`, `getTransport`, `prewarmWorkspaceSkillLoad`, the three
  skill-load-safe session request wrappers, `errorText`, `RequestError`, `wsErrorCode`, `ConnectionStatus`,
  `TransportOptions`. `supportsSessionActivity` stays module-internal (its own tests import the file
  directly) — no sibling decides the activity capability, this module does.
- **Allowed deps:** `contracts` (method maps, `WS_CHANNELS`, `Project` for welcome + `project.updated`, `SessionEventPayload`
  for `pi.event`, `ExtUiRequest` for `pi.extensionUi`, `Workspace` for `workspace.created`/`updated`,
  `WorkspaceRemoved` for `workspace.removed`, `SessionCreatedPayload` for `session.created`,
  `SessionDeletedPayload` for `session.deleted`, `SessionActivityPayload` +
  `ACTIVITY_PROTOCOL_VERSION` for `session.activity` and its snapshot gate, `provider.changed`, the empty addressed
  `feedback.interview` invitation, `WorkspaceFsChangedPayload` for `workspace.fsChanged`, and `AppConfig` for
  `server.welcome`'s config + `settings.changed`); `store`
  (welcome + event routing — a runtime edge owned by the parent graph); `lib` (plain-HTTP-safe random page
  identity); the browser `WebSocket`.
- **Forbidden:** `server`/`shared`/any `pi` package; importing `panels`/`shell`; or requesting, subscribing to, or folding current-layout state. Layout persistence uses only `httpBase()` as part of its frontend-local storage identity.

## Get right

- **`DEFAULT_TIMEOUT_MS` is the ceiling a host-side budget has to fit under, and nothing enforces it.**
  The server bounds network `git` at 55s precisely so its own error — naming the ref, carrying git's
  stderr — wins the race against the causeless `request "…" timed out` this side raises at 60s (issue #209;
  `packages/server/src/git/SPEC.md`). Lower this number below that budget and every stalled fetch silently
  reverts to the generic timeout, with no test or type failing to say so. The two constants live in
  independently-shipped artifacts and are correct by agreement; deriving them from one another belongs in
  `contracts`. Raising a per-request `timeoutMs` is safe, lowering the default is not.
