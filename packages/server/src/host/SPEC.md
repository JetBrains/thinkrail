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
  `ackSend.ts` (the send-ack policy — see "Get right"); `autoRename.ts` (the **workspace auto-rename
  flow** — the composition of `agent` + `assist` + `workspaces` only the host may make:
  `maybeAutoRenameWorkspace(sessionId, workspaceId)` is teed from the session publisher closure in
  `createServer` on every **settled** turn (`isSettledTurn(event)`, exported: `agent_end` with
  `willRetry: false`), fire-and-forget. It reads the session **transcript** via `getSessionMessages`
  (never `agent_end.messages` — that array is run-local and empty of the prompt on auto-retry
  continuations), extracts the first **clean** turn (assist's `extractFirstTurn` skips killed
  error/aborted turns, so a retracted prompt never becomes the name), asks assist for a slug, re-checks
  the workspace (exists, not `renamed`) after the await, then calls `renameWorkspace` in the same tick
  and resolves to the updated `Workspace` for the caller to push on **`workspace.updated`**. Best-effort
  by contract: every failure path resolves `null` and leaves the flag unset so a later settled turn
  retries — but a swallowed exception is `console.warn`ed (a broken rename path must stay
  distinguishable from "assist had nothing"). A per-workspace **in-flight set** — not the flag — dedupes
  concurrent turns/sessions. An injectable transcript reader is the unit-test seam).
- **Public surface (barrel):** `createServer`, `CreateServerOptions`, `RunningServer`, `bootHost`,
  `BootHostOptions`, `BootedHost`.
- **Allowed deps:** `contracts` (`PROTOCOL_VERSION`, `WS_CHANNELS`); `shared` (`freePort`, `shellEnv` — for
  `boot.ts`); the feature modules it composes (per the parent dependency graph); Bun/Node.
- **Forbidden:** being imported by any feature module; importing `web`/`cli`/`desktop`.

## Get right

- WS commands return values directly; only events + extension-UI + host-initiated workspace mutations
  (`workspace.updated`, published from the auto-rename tee with the full persisted snapshot) use push
  channels. Every push channel a client should hear must be `ws.subscribe`d in the WS `open` handler —
  a publish on an unsubscribed topic reaches nobody, silently.
- The host is the single place features are wired together — features never reach back into it.
- **A send (prompt/steer/followUp) is acked when ACCEPTED, not when the turn ends** (`ackSend`): pi's send
  methods resolve only at turn end, and a turn can outlive the client's request timeout (an
  `ask_user_question` turn blocks until the user answers) — awaiting completion would surface a phantom
  "request timed out" over a healthy turn. A rejection inside the ack window still fails the request (bad
  model / missing key); later faults reach the client via the event stream.
