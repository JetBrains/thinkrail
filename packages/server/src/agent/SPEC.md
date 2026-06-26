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

The in-process `pi` engine: a shared runtime (auth + model registry), the lifecycle of `AgentSession`s
(one per chat tab, rooted in a workspace's worktree), and the **extension-UI bridge** that turns pi's
in-process `uiContext` dialog calls into WS frames.

## Boundary

- **Owns:**
  - `piRuntime` (one shared `AuthStorage` + `ModelRegistry`; `getPiRuntime()` lazy,
    `configurePiRuntime()` for tests).
  - `agentSessionManager` — sessions keyed by `session.sessionId`,
    `createSession({ cwd, model?, thinkingLevel? })` → `createAgentSession(...)` with a per-session
    `SessionManager` + `bindExtensions({ mode:'rpc', uiContext })`; `subscribe` forwards each event tagged
    with its id; `prompt`/`steer`/`followUp` (with images) / `abort` / `setModel` / `setThinkingLevel` /
    `compact` / `getSessionStats` (+ contextUsage) / `getSessionCommands` / `listAvailableModels`;
    `removeSession`/`disposeAllSessions`; `setSessionPublisher` + `setSessionManagerFactory` seams.
  - `webUiContext` — `createWebUiContext(sessionId)` builds the `ExtensionUIContext` pi calls (dialogs
    round-trip to the browser, fire-and-forget methods push, TUI-only members inert); `setExtUiPublisher`
    (server→client push seam), `resolveExtUi` (browser reply), `cancelExtUiForSession` (on dispose),
    `notifyExtUi`.
- **Public surface (barrel):** the manager operations + `CreateSessionInput`/`CreateSessionResult` +
  `SessionEventPayload`; `configurePiRuntime`/`getPiRuntime`; the `webUiContext` seams.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (runtime); `contracts` (`PiEvent`/`Model`/
  `ThinkingLevel`/`ImageContent`/`SessionStats`/`SlashCommandInfo`/`ExtUi*`); Node.
- **Forbidden:** `host`; sibling features (the `cwd` is passed in, not looked up via `persistence`).

## Get right

- `prompt()` throws while a session is streaming → `promptSession` falls back to `steer()`.
- Errors arrive via the event stream + thrown methods, not a crash signal — wrap + forward.
- Share one `authStorage`/`modelRegistry`; give each session its own `SessionManager`; `dispose()` on removal.
- The slash-command list is derived from the **same three sources pi's rpc mode uses**
  (`extensionRunner.getRegisteredCommands()` + `promptTemplates` + `resourceLoader.getSkills()`).
- Dialog promises honor abort/timeout and are settled (+ dismissed in the UI) on session disposal — a
  bridged `uiContext` call must never hang.
