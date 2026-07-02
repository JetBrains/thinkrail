---
id: submodule-server-agent
type: submodule-design
status: active
title: agent — in-process pi sessions
parent: module-server
depends-on: [module-contracts]
references: [module-spec-graph]
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
  - `agentSessionManager` — sessions keyed by `session.sessionId` (each `Entry` also tracks its
    `workspaceId`), `createSession({ cwd, workspaceId, model?, thinkingLevel? })` → `createAgentSession(...)`
    with a per-session `SessionManager` **and a `buildSessionSettings(cwd)` settings manager** (the user's
    real settings + an in-memory `images.autoResize:false` override — never persisted — so the `read` tool
    sends image files **raw**, bypassing pi's photon/WASM resizer that the single-file binary can't bundle;
    the web UI downsizes user-attached images itself); a shared `registerSession` forwards each event tagged with its id +
    `bindExtensions({ mode:'rpc', uiContext })`; `prompt`/`steer`/`followUp` (with images) / `abort` /
    `setModel` / `setThinkingLevel` / `compact` / `getSessionStats` (+ contextUsage) / `getSessionCommands` /
    `listAvailableModels` / `getDefaultModel` (the model + thinking a fresh session resolves to — settings
    default if available, else first available — so the New-Workspace dialog shows the exact pre-session
    model); the **hydration read side** — `listSessions(workspaceId, cwd)` (live sessions
    **unioned with on-disk** ones pi persisted under `cwd`, live winning on id → `SessionSummary[]` tagged
    `live`) + `getSessionMessages(sessionId, workspaceId, cwd)` (re-opens a disk session into the manager if
    not live, then returns `{ summary, messages }` — the pi-canonical `Message` subset); the disk half is
    what survives a host **restart**; `removeSession`/`disposeAllSessions`; `setSessionPublisher` +
    `setSessionManagerFactory` seams.
  - `oneshot` — one-shot LLM completions **without** an `AgentSession` (no tools/extensions/disk):
    `completeOnce(request)` picks a model from the shared runtime's authenticated set, resolves its auth
    (OAuth refresh included) via `modelRegistry.getApiKeyAndHeaders`, and dispatches a single `complete()`
    (from `@earendil-works/pi-ai/compat` — the api-dispatch entry; re-verify on pi bumps, it's a compat
    surface). `pickModel(tier)` = the model choice: `cheap` prefers a curated small/fast allowlist ∩ the
    authenticated set, else the cheapest by per-token cost; `default` = first available; `null` when
    nothing is authenticated. This is the primitive the `assist` tasks (workspace naming, PR drafting)
    run on — the only place model **dispatch** happens outside a session.
  - `webUiContext` — `createWebUiContext(sessionId)` builds the `ExtensionUIContext` pi calls (dialogs
    round-trip to the browser, fire-and-forget methods push, TUI-only members inert); `setExtUiPublisher`
    (server→client push seam), `resolveExtUi` (browser reply), `cancelExtUiForSession` (on dispose),
    `notifyExtUi`.
  - `extensions` — `buildResourceLoader(cwd, settingsManager)`: a `DefaultResourceLoader` (pi's normal
    disk discovery) that also loads three bundled extensions via `additionalExtensionPaths` (pi's loader
    jiti-loads their raw `.ts` — no value-import into our typecheck): **`pi-web-access`** (`web_search` +
    `fetch_content`), **`pi-visualize`** (`visualize`), and **`pi-spec-graph`** (the `spec_*` tools + its
    `before_agent_start` rule). The last is a workspace package, so its `pi.skills` manifest isn't
    auto-discovered — its `skills/` dir is wired via **`additionalSkillPaths`**. Plus a tiny
    `extensionFactories` **headless-search policy** (a `tool_call` hook defaulting `web_search`'s `workflow`
    to `"none"`, since pi-web-access would otherwise open a browser curator our `rpc` host can't render).
    Both session paths pass it as `resourceLoader`. Internal helper (not on the barrel).
- **Public surface (barrel):** the manager operations + `CreateSessionInput`/`CreateSessionResult` +
  `SessionEventPayload`; `configurePiRuntime`/`getPiRuntime`; `completeOnce`/`pickModel` +
  `OneShotRequest`/`OneShotResult`/`ModelTier`; the `webUiContext` seams.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (runtime); `@earendil-works/pi-ai` (runtime — the
  `complete()` dispatch used by `oneshot`); `pi-web-access` + `pi-visualize` + `pi-spec-graph` (the bundled
  extensions — loaded by path, not value-imported); `contracts` (`PiEvent`/`Model`/`ThinkingLevel`/
  `ImageContent`/`SessionStats`/`SlashCommandInfo`/`ExtUi*`); Node.
- **Forbidden:** `host`; sibling features (the `cwd` is passed in, not looked up via `persistence`).

## Get right

- `prompt()` throws while a session is streaming → `promptSession` falls back to `steer()`.
- Errors arrive via the event stream + thrown methods, not a crash signal — wrap + forward.
- Share one `authStorage`/`modelRegistry`; give each session its own `SessionManager`; `dispose()` on removal.
- The slash-command list is derived from the **same three sources pi's rpc mode uses**
  (`extensionRunner.getRegisteredCommands()` + `promptTemplates` + `resourceLoader.getSkills()`).
- Dialog promises honor abort/timeout and are settled (+ dismissed in the UI) on session disposal — a
  bridged `uiContext` call must never hang.
