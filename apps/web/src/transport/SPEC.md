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

The single WebSocket client to the host, and its app-wide singleton.

## Boundary

- **Owns:** `transport.ts` (`WsTransport`: id-correlated `request` — replies time out after 60s unless the
  caller raises `timeoutMs`, which a request the host answers *only once a human has* must do (an open
  folder dialog: a fired timeout also drops the reply that follows it) —, the **`?client=` page identity** it
  appends to the socket URL (minted lazily and *not* via the secure-context-only `crypto.randomUUID`, so a
  plain-http remote origin still boots; it spans reconnects but not reloads, which is what lets the host own
  per-client resources like PTYs without losing them to a hiccup), **reconnect-safe unresolved requests** — a
  frame that was in flight when its socket died returns to the queue and is replayed under the same request id,
  while the host deduplicates `(clientKey, requestId)`, so an accepted mutation cannot become a false failure or
  execute twice —, the two frames that are this side's half of that bargain — **`{ ack: [id] }` receipts**
  (every response read is acknowledged, batched on a microtask; until one arrives the host must assume the reply
  died with the socket and keep it replayable) and the **`{ resume: [ids] }` reconciliation** sent on every
  (re)connect *before* the replays (the complete still-unresolved set, so the host releases everything else).
  Receipts are deliberately best-effort and never retransmitted — one can die in a socket buffer exactly like a
  response can, and the request it named is already gone from `pending`, so nothing would replay or re-ack it;
  `resume` repairs them all at once by restating the truth rather than confirming the confirmations —, channel `subscribe` with last-value replay, reconnect/backoff; `inferUrl` defaults to
  same-origin; **`httpBase()`** derives the host's HTTP origin
  from the WS `url` — for building host HTTP URLs like the `/files/<workspaceId>/<path>` worktree-file
  endpoint the markdown viewer points relative `<img>`s at, targeting the same host the transport dials); `wireTransport.ts` (`initTransport`/
  `getTransport` singleton; routes `server.welcome`, **`project.updated`**, `pi.event`, `pi.extensionUi`,
  **the `workspace.created`/`updated`/`removed` lifecycle trio, and `workspace.fsChanged`** into the store —
  welcome's open + recent project views via `installProjectSnapshot`, project snapshots via
  `applyProjectUpdated`, `pi.event` via `handlePiEvent(event, sessionId)`, `pi.extensionUi` via `applyExtUi(request)`,
  `workspace.created` via `addWorkspace(workspace)`, `workspace.updated` via `updateWorkspace(workspace)`,
  `workspace.removed` via `applyWorkspaceRemoved(projectId, id)`, `workspace.fsChanged` via
  `noteFsChanged(payload)`, and **`settings.changed`** (+ the `config` field in `server.welcome`) via
  `applyConfig(config)` — the server-synced app config (theme, …), applied on connect + on every broadcast
  so clients converge; all subscriptions happen once at init, never in component effects);
  `errorText.ts` (**`errorText(err, fallback?)`** — normalizes a rejected `request` (the host's error
  string / a timeout / a thrown non-Error) into a short, display-ready line for an error turn/notice);
  `requestError.ts` (**`RequestError`** + **`wsErrorCode(err)`** — a rejection that carries the host's named
  `WsResponse.errorCode`. A coded response rejects with a `RequestError`, everything else (timeout or an unnamed
  host error) with a plain `Error`, so *having* a code is exactly how a caller tells "this
  specific failure" from "the read failed"); `skillLoad.ts` (the one app-integration coordinator for session
  resource loads: single-flight `workspace.watchReady` per workspace; unless the watcher was already known
  ready, fold the conservative wildcard locally as a replay-safe fallback; capture the store tick only
  afterward; then wrappers issue `session.create` / `session.getMessages` / `session.reloadResources`, so no
  call site can accidentally reverse readiness and baseline ordering).
- **Public surface (barrel):** `initTransport`, `getTransport`, the three skill-load-safe session request
  wrappers, `errorText`, `RequestError`, `wsErrorCode`, `ConnectionStatus`, `TransportOptions`.
- **Allowed deps:** `contracts` (method maps, `WS_CHANNELS`, `Project` for welcome + `project.updated`, `SessionEventPayload`
  for `pi.event`, `ExtUiRequest` for `pi.extensionUi`, `Workspace` for `workspace.created`/`updated`,
  `WorkspaceRemoved` for `workspace.removed`, `WorkspaceFsChangedPayload` for `workspace.fsChanged`,
  `AppConfig` for `server.welcome`'s config + `settings.changed`); `store`
  (welcome + event routing — a runtime edge owned by the parent graph); the browser `WebSocket`.
- **Forbidden:** `server`/`shared`/any `pi` package; importing `panels`/`shell`.
