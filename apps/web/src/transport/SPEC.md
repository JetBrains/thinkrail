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
  replay, reconnect/backoff; `inferUrl` defaults to same-origin); `wireTransport.ts` (`initTransport`/
  `getTransport` singleton; routes the `server.welcome`, `pi.event`, `pi.extensionUi`,
  **`workspace.updated`**, and **`auth.event`** pushes into the store — `pi.event` via
  `handlePiEvent(event, sessionId)`, `pi.extensionUi` via `applyExtUi(request)`, `workspace.updated`
  via `updateWorkspace(workspace)`, `auth.event` via `applyAuthEvent(event)`;
  all subscriptions happen once at init, never in component effects); **`refreshAuthStatus()`** — the
  auth/model re-read (`auth.status` + `model.list` → store), fired on every `server.welcome` (arms the
  gate with a definitive modelCount) and on every `auth.event` `changed` frame (closes it reactively);
  `errorText.ts` (**`errorText(err, fallback?)`** — normalizes a rejected `request` (the host's error
  string / a timeout / a thrown non-Error) into a short, display-ready line for an error turn/notice).
- **Public surface (barrel):** `initTransport`, `getTransport`, `refreshAuthStatus`, `errorText`,
  `ConnectionStatus`, `TransportOptions`.
- **Allowed deps:** `contracts` (method maps, `WS_CHANNELS`, `Project` for welcome, `SessionEventPayload`
  for `pi.event`, `ExtUiRequest` for `pi.extensionUi`, `Workspace` for `workspace.updated`, `AuthEvent`
  for `auth.event`); `store`
  (welcome + event routing — a runtime edge owned by the parent graph); the browser `WebSocket`.
- **Forbidden:** `server`/`shared`/any `pi` package; importing `panels`/`shell`.
