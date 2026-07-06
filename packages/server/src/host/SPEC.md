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
  flow** — the composition of `agent` + `assist` + `workspaces` only the host may make, in **two passes**
  the session-publisher closure in `createServer` tees fire-and-forget, both pushing **`workspace.updated`**
  and both reading the session **transcript** via `getSessionMessages` (never `agent_end.messages` — that
  array is run-local and empty of the prompt on auto-retry continuations) then `extractFirstTurn` (assist
  skips killed error/aborted turns, so a retracted prompt never becomes the name); an injectable
  transcript reader is the unit-test seam:
  - **Naive (instant):** `maybeNaiveNameWorkspace(sessionId, workspaceId)` when the **first prompt lands**
    (`isPromptCommitted(event)`, exported: a **user `message_end`** — `agent_start`/`turn_start` fire
    *before* the prompt's `message_end`, so the transcript wouldn't yet hold the prompt at those; this
    still fires before the model responds, so the name is instant and no tool/question can block it). It
    derives a slug from the first prompt with assist's non-agentic `naiveWorkspaceSlug` (no model call)
    and renames **provisionally** (`renameWorkspace(..., { lock: false })` — name + branch move but
    `renamed` stays unset). It fires only on a **pristine** workspace (`!renamed` AND name still
    `workspace-N`), so it lands once and never overwrites a user/agentic name; a per-workspace `naiveInFlight`
    set dedupes re-fired prompt-commits. This is why a long first turn no longer leaves the workspace as
    `workspace-N` for minutes.
  - **Agentic (refine):** `maybeAutoRenameWorkspace(sessionId, workspaceId)` on every **settled** turn
    (`isSettledTurn(event)`, exported: `agent_end` with `willRetry: false`). It asks assist for a slug
    (cheap model), re-checks the workspace (exists, not `renamed`) after the await, then calls
    `renameWorkspace` in the same tick — upgrading the provisional naive slug into the final name and
    **locking** it (`renamed: true`). Best-effort by contract: every failure path resolves `null` and
    leaves the flag unset so a later settled turn retries — but a swallowed exception is `console.warn`ed
    (a broken rename path must stay distinguishable from "assist had nothing"). Its own per-workspace
    **in-flight set** (independent of the naive one — the two passes can overlap on a short turn) dedupes
    concurrent turns/sessions.
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
