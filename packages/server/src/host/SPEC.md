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
and channel fan-out.

## Boundary

- **Owns:** `server.ts` (`createServer` → `Bun.serve` with `/health`, `/ws` upgrade, static serving with
  `index.html` fallback, the `server.welcome` push, `terminal.data` topic subscribe + `server.publish`,
  and `stop()` → terminal/session cleanup); `handlers.ts` (the WS method→handler registry).
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`); the feature modules it composes (per
  the parent dependency graph); Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`.

## Get right

- WS commands return values directly; only events + extension-UI use push channels.
- The host is the single place features are wired together — features never reach back into it.
