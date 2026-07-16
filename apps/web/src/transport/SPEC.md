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

- **Owns:** `transport.ts` (`WsTransport`: id-correlated `request`, channel `subscribe` with last-value
  replay, reconnect/backoff; `inferUrl` defaults to same-origin; **`httpBase()`** derives the host's HTTP origin
  from the WS `url` — for building host HTTP URLs like the `/files/<workspaceId>/<path>` worktree-file
  endpoint the markdown viewer points relative `<img>`s at, targeting the same host the transport dials); `wireTransport.ts` (`initTransport`/
  `getTransport` singleton; routes the `server.welcome`, `pi.event`, `pi.extensionUi`, **the
  `workspace.created`/`updated`/`removed` lifecycle trio, and `workspace.fsChanged`** into the store —
  `pi.event` via `handlePiEvent(event, sessionId)`, `pi.extensionUi` via `applyExtUi(request)`,
  `workspace.created` via `addWorkspace(workspace)`, `workspace.updated` via `updateWorkspace(workspace)`,
  `workspace.removed` via `applyWorkspaceRemoved(projectId, id)`, `workspace.fsChanged` via
  `noteFsChanged(payload)`; all subscriptions happen once at init, never in component effects);
  `errorText.ts` (**`errorText(err, fallback?)`** — normalizes a rejected `request` (the host's error
  string / a timeout / a thrown non-Error) into a short, display-ready line for an error turn/notice).
- **Public surface (barrel):** `initTransport`, `getTransport`, `errorText`, `ConnectionStatus`, `TransportOptions`.
- **Allowed deps:** `contracts` (method maps, `WS_CHANNELS`, `Project` for welcome, `SessionEventPayload`
  for `pi.event`, `ExtUiRequest` for `pi.extensionUi`, `Workspace` for `workspace.created`/`updated`,
  `WorkspaceRemoved` for `workspace.removed`, `WorkspaceFsChangedPayload` for `workspace.fsChanged`); `store`
  (welcome + event routing — a runtime edge owned by the parent graph); the browser `WebSocket`.
- **Forbidden:** `server`/`shared`/any `pi` package; importing `panels`/`shell`.
