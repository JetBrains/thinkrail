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

- **Owns:** `server.ts` (`createServer` → `Bun.serve` with `/health`, `/ws` upgrade, static serving with
  `index.html` fallback, the `server.welcome` push, `terminal.data` topic subscribe + `server.publish`,
  an optional boot-time `openProject(projectPath)` (best-effort — a launcher convenience), and
  `stop()` → agent-session + terminal cleanup then socket close); `boot.ts` (`bootHost` → resolve the
  login-shell PATH, pick the port per `portMode` (`"exact"` vs `"free"`), start `createServer`, and
  install SIGINT/SIGTERM handlers that `stop()` then exit); `handlers.ts` (the WS method→handler registry);
  `ackSend.ts` (the send-ack policy — see "Get right").
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, `BootedHost`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv` — for
  `boot.ts`); the feature modules it composes (per the parent dependency graph); Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`.

## Get right

- WS commands return values directly; only events + extension-UI use push channels.
- The host is the single place features are wired together — features never reach back into it.
- **A send (prompt/steer/followUp) is acked when ACCEPTED, not when the turn ends** (`ackSend`): pi's send
  methods resolve only at turn end, and a turn can outlive the client's request timeout (an
  `ask_user_question` turn blocks until the user answers) — awaiting completion would surface a phantom
  "request timed out" over a healthy turn. A rejection inside the ack window still fails the request (bad
  model / missing key); later faults reach the client via the event stream.
