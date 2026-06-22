---
id: module-server
type: module-design
status: draft
title: Engine host (server library)
parent: architecture
depends-on: [module-contracts, module-shared]
tags: [v1, host]
---

## Responsibility

The engine host as an embeddable library. Runs the `pi` agent **in-process** via `createAgentSession` and
bridges it to the browser↔host wire. Launched in-process by `apps/cli` (and later `apps/desktop`) — it has
no standalone entrypoint of its own.

## Surface

- `createServer({ port, host, staticDir, hooks? }) → { port, stop }` — `Bun.serve` for HTTP + WS, static
  SPA serving, `/health`, and WS dispatch.
- **Shared setup, once at startup:** `resolveShellEnv()`, then `AuthStorage.create()` and
  `ModelRegistry.create(authStorage)` — shared across all sessions.
- **`AgentSessionManager`** — `Map<sessionId, ManagedSession>` (`{ session, unsubscribe }`). `create`
  builds an `AgentSession` via `createAgentSession({ cwd, authStorage, modelRegistry, sessionManager:
  SessionManager.create(cwd), model?, thinkingLevel? })`, subscribes, and `bindExtensions({ mode: "rpc",
  uiContext, onError })`. `remove` → `unsubscribe()` + `session.dispose()`; `disposeAll()` on shutdown.
- Handlers split two ways: **session methods** (`session.*` → look up the `AgentSession` and call
  `prompt/steer/followUp/abort/setModel/setThinkingLevel/getSessionStats/…`, returning the value as the WS
  response) and **direct**: `project.*` (open/list git repos) · `workspace.*` (git-worktree
  add/list/remove/diff, under `~/.thinkrail-pi/worktrees`) · `fs.*` (readDir/readFile, path-contained to
  the active worktree) · `git.*` (status/diff) · `terminal.*` · `settings.*`/`app.*`.
- `persistence.ts` (app state under `~/.thinkrail-pi`), `sessionListing.ts` (`SessionManager.listAll`),
  `terminalManager.ts`.

## Get right

- **`prompt()` throws while a session is streaming** — call `steer()` / `followUp()` instead.
- **Errors arrive via the event stream + thrown methods, not a crash signal** (`agent_end.willRetry`,
  `auto_retry_*`, `session.state.errorMessage`). Wrap each call and forward to that session's WS client.
- **No process isolation** — a fatal agent/provider error in one session can take the whole host down
  (accepted tradeoff; the subprocess RPC mode is the alternative if isolation ever matters).
- Sessions are independent and concurrent — turns interleave on the one event loop. Share `authStorage` +
  `modelRegistry`; give each session its own `SessionManager`. `dispose()` on removal or you leak.
- **WS commands return values directly**; only events + extension-UI use push channels (`pi.event` tagged
  with `sessionId`; `pi.extensionUi`).
- One id model: the UI tab id vs `session.sessionId` (no separate pi UUID).
- Binds beyond localhost via `host` (the Tailscale seam).

## Later

Wrap `~/.thinkrail-pi` reads/writes behind the persistence layer so V2 can add a durable store (spec index,
cost ledger, suggestions, automations). Thread an `owner` through sessions.
