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
  `getTransport` singleton; routes the `server.welcome` **and `pi.event`** pushes into the store — the
  latter via `handlePiEvent(event, sessionId)`).
- **Public surface (barrel):** `initTransport`, `getTransport`, `ConnectionStatus`, `TransportOptions`.
- **Allowed deps:** `contracts` (method maps, `WS_CHANNELS`, `Project` for welcome, `SessionEventPayload`
  for `pi.event`); `store` (welcome + event routing — a runtime edge owned by the parent graph); the
  browser `WebSocket`.
- **Forbidden:** `server`/`shared`/any `pi` package; importing `panels`/`shell`.
