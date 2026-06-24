---
id: submodule-server-agent
type: submodule-design
status: active
title: agent — in-process pi sessions
parent: module-server
depends-on: [module-contracts]
tags: [v1, pi]
---

## Responsibility

The in-process `pi` engine: a shared runtime (auth + model registry) and the lifecycle of
`AgentSession`s, one per chat tab, rooted in a workspace's worktree.

## Boundary

- **Owns:** `piRuntime` (one shared `AuthStorage` + `ModelRegistry`; `getPiRuntime()` lazy,
  `configurePiRuntime()` for tests); `agentSessionManager` — sessions keyed by `session.sessionId`,
  `createSession({ cwd, model?, thinkingLevel? })` → `createAgentSession(...)` with a per-session
  `SessionManager`; `subscribe` forwards each event tagged with its id; `prompt`/`steer`/`followUp`/
  `abort`/`setModel`/`setThinkingLevel`/`getSessionStats`; `removeSession`/`disposeAllSessions`;
  `setSessionPublisher` + `setSessionManagerFactory` seams.
- **Public surface (barrel):** the manager operations + `SessionEventPayload`/`CreateSessionInput` +
  `configurePiRuntime`/`getPiRuntime`.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (runtime); `contracts` (`PiEvent`/`Model`/
  `ThinkingLevel`); Node.
- **Forbidden:** `host`; sibling features (the `cwd` is passed in, not looked up via `persistence`).

## Get right

- `prompt()` throws while a session is streaming → `promptSession` falls back to `steer()`.
- Errors arrive via the event stream + thrown methods, not a crash signal — wrap + forward.
- Share one `authStorage`/`modelRegistry`; give each session its own `SessionManager`; `dispose()` on removal.
