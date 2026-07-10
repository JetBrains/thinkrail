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
(one per chat tab, rooted in a workspace's worktree), the **extension-UI bridge** that turns pi's
in-process `uiContext` dialog calls into WS frames, and the host-owned **`ask_user_question`** tool +
its inline answer bridge.

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
    what survives a host **restart**; `getSessionWorkspaceId(sessionId)` (the live session→workspace
    lookup the host's auto-rename hook keys on); `removeSession`/`disposeAllSessions`;
    **`removeWorkspaceSessions(workspaceId, cwd?)`** (the **archive teardown**: abort a streaming turn,
    `removeSession` every live session for the workspace, then delete pi's on-disk transcripts rooted at
    the worktree `cwd` — pi's `SessionManager` is append-only, so purge = `list(cwd)` then `rm` the files
    whose recorded `cwd` matches, never `rm -rf` the encoded dir since pi's cwd→dir encoding can alias
    distinct cwds; `cwd` omitted on a double-archive skips only the disk purge);
    `setSessionPublisher` + `setSessionManagerFactory` seams.
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
  - `askUserQuestion` — the host-owned **`ask_user_question`** pi custom tool (`createAskUserQuestionTool`,
    registered on every session via the `askUserQuestionExtension` factory in `extensions`).
    **Rejected alternative** (the one place this decision is recorded): bundling the community
    `@juicesharp/rpiv-ask-user-question` extension. Its questionnaire UI is a live pi-tui component handed
    to the host via `ctx.ui.custom(factory)` — *code, not data* — so it can't be serialized over the WS
    bridge or hosted by a browser; the tool would block forever. Interception is technically possible
    (stub the TUI in `webUiContext.custom`, capture the factory's `done` callback, synthesize its result)
    but couples us to two fast-moving packages' private internals (the result shape `done` expects, the
    TUI surface the factory touches) and still requires all the same browser-side work — so we own the
    small LLM-facing contract instead (schema/validation/envelope mirror the rpiv tool's so the model
    behaves the same). Ours renders **nothing** — its
    `execute` guards on `ctx.hasUI`, runs the pure `validateQuestionnaire`, then **blocks** awaiting a
    structured `AskUserQuestionResult` from the browser (keyed by the unique tool call id, cancelled on the
    agent abort `signal`), and formats the LLM envelope with `buildQuestionnaireResponse` (a partial
    submission lists its unanswered questions explicitly as declined). The reply arrives over
    `session.answerQuestion` → `answerQuestion(sessionId, toolCallId, result)`; the WS handler vets the
    session is live (`hasSession`) and the result shape before forwarding. **The reply can beat the tool:**
    the inline card is interactive as soon as the tool call's args stream in, but `execute` (which registers
    the pending entry) only runs once the assistant message completes — so an answer with no pending entry
    is **held**, keyed by tool call id, and consumed when `awaitAnswer` registers (only if the session
    matches; holds are bounded per session, oldest evicted). `cancelQuestionsForSession(sessionId)` (called
    from `removeSession`/`disposeAllSessions`) settles any awaiting question as cancelled and drops the
    session's held answers. The
    questionnaire is rendered **inline** in chat by `apps/web`'s `AskUserQuestionCard` (joined by tool name).
    Correlation is exact because `ctx.sessionManager.getSessionId()` **is** the `AgentSession.sessionId` we
    key on. The LLM-facing contract (TypeBox schema, validation, envelope) is re-implemented here so we own
    it and avoid the package's pi-tui/i18n peer deps.
  - `extensions` — `buildResourceLoader(cwd, settingsManager)`: a `DefaultResourceLoader` (pi's normal
    disk discovery) that also loads the four bundled extensions — **`pi-web-access`** (`web_search` +
    `fetch_content`), **`pi-visualize`** (`visualize`), **`pi-spec-graph`** (the `spec_*` tools + its
    `before_agent_start` rule), and **`pi-thinkrail-workflow`** (the workflow-router rule + workflow skills) — in one
    of **two modes**:
    - **Run-from-source (default):** `additionalExtensionPaths` pointing at the packages' raw `.ts`
      entries (pi's loader jiti-loads them — no value-import into our typecheck graph), resolved
      **lazily on first use** (never at module load: the resolve requires `node_modules`, which a
      compiled binary lacks). The workspace packages' `pi.skills` manifests aren't auto-discovered for
      file-path entries — their `skills/` dirs (`pi-spec-graph`, `pi-thinkrail-workflow`) are wired via
      **`additionalSkillPaths`**.
    - **Compiled binary:** the launcher calls the **`setBundledExtensions({ factories, skillsDir })`
      seam** before the first session — the same four extensions as **value-imported default-export
      factories** (pi gives `extensionFactories` full API parity with path loading; what's lost —
      file-relative `baseDir`, per-reload re-evaluation — none of the four use) plus a staged on-disk
      skills dir (pi reads `SKILL.md` via plain fs, so skills must live on the real filesystem).
    Both modes append `extensionFactories`: a **headless-search policy** (a `tool_call` hook defaulting
    `web_search`'s `workflow` to `"none"`, since pi-web-access would otherwise open a browser curator our
    `rpc` host can't render) **and** `askUserQuestionExtension` (registers the `ask_user_question` tool).
    Both session paths pass it as `resourceLoader`. `buildResourceLoader` stays internal; the seam +
    its types are on the barrel.
- **Public surface (barrel):** the manager operations + `CreateSessionInput`/`CreateSessionResult` +
  `SessionEventPayload`; `configurePiRuntime`/`getPiRuntime`; `completeOnce`/`pickModel` +
  `OneShotRequest`/`OneShotResult`/`ModelTier`; the `webUiContext` seams; the
  `askUserQuestion` bridge (`answerQuestion`/`cancelQuestionsForSession`) + its pure helpers
  (`validateQuestionnaire`/`buildQuestionnaireResponse`); the compiled-binary extension seam
  (`setBundledExtensions` + `BundledExtensions`/`BundledExtensionFactory`).
- **Allowed deps:** `@earendil-works/pi-coding-agent` (runtime); `@earendil-works/pi-ai` (runtime — the
  `complete()` dispatch used by `oneshot`); `pi-web-access` + `pi-visualize` + `pi-spec-graph` +
  `pi-thinkrail-workflow` (the bundled extensions — loaded by path, never value-imported here; the
  compiled binary's value-imports live in `apps/cli`'s generated build module); `typebox` (the
  `ask_user_question` parameter schema);
  `contracts` (`PiEvent`/`Model`/`ThinkingLevel`/`ImageContent`/`SessionStats`/`SlashCommandInfo`/`ExtUi*`/
  `AskUserQuestion*`); Node.
- **Forbidden:** `host`; sibling features (the `cwd` is passed in, not looked up via `persistence`).

## Get right

- `prompt()` throws while a session is streaming → `promptSession` falls back to `steer()`.
- Errors arrive via the event stream + thrown methods, not a crash signal — wrap + forward.
- Share one `authStorage`/`modelRegistry`; give each session its own `SessionManager`; `dispose()` on removal.
- The slash-command list is derived from the **same three sources pi's rpc mode uses**
  (`extensionRunner.getRegisteredCommands()` + `promptTemplates` + `resourceLoader.getSkills()`).
- Dialog promises honor abort/timeout and are settled (+ dismissed in the UI) on session disposal — a
  bridged `uiContext` call must never hang.
