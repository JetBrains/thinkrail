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

The in-process `pi` engine: a shared model/auth runtime, the lifecycle of `AgentSession`s
(one per chat tab, rooted in a workspace's worktree), the **extension-UI bridge** that turns pi's
in-process `uiContext` dialog calls into WS frames, the host-owned **`ask_user_question`** tool + its
answer-injection path, and the **restart repair** that keeps re-opened transcripts provider-valid.

## Boundary

- **Owns:**
  - `piRuntime` (one shared `ModelRuntime` — pi's canonical model/auth facade since 0.80.8: catalogs,
    credentials, availability, login/logout, and request dispatch; `getPiRuntime()` is a lazily-memoized
    **promise** (`ModelRuntime.create()` is async; a failed create clears the memo so the next call
    retries), `configurePiRuntime()` for tests). The **provider-credential surface** over this runtime —
    `provider.status` + in-app login — lives in the sibling `auth` module (which consumes `getPiRuntime`),
    **not** here.
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
    model). **Models cross the wire as `WireModel` (never pi's raw `Model`):** `toWireModel` projects a
    `Model` onto the wire's **allowlist** (id/name/provider/contextWindow/reasoning) — so `baseUrl` (the
    jbcentral proxy secret when JetBrains AI is wired), `headers`, and any other field are excluded by
    default — and the inbound side (`createSession`/`setModel`) **re-resolves** the ref by `{provider,id}`
    via `resolveWireModel` against `getAvailable()` — pi uses `Model.baseUrl` verbatim, so a client's baseUrl
    is never trusted (blocks disclosure *and* arbitrary-URL injection). The **hydration read side** —
    `listSessions(workspaceId, cwd)` (live sessions
    **unioned with on-disk** ones pi persisted under `cwd`, live winning on id → `SessionSummary[]` tagged
    `live`) + `getSessionMessages(sessionId, workspaceId, cwd)` (re-opens a disk session into the manager if
    not live, then returns `{ summary, messages }` — `TranscriptMessage[]`: the pi-canonical subset **plus
    `custom` messages**, which carry the `ask-user-answers` replies the questionnaire card pairs by tool
    call id); the disk half is what survives a host **restart** — and re-attaching runs
    **`repairDanglingToolCalls` (the `sessionRepair` sibling) BEFORE `createAgentSession` seeds its
    context**: a host death mid-tool leaves an assistant message with unpaired `toolCall`s, every provider
    rejects such a context (the chat would brick), and appending behind a live session would desync its
    in-memory state — so orphans are paired at the one choke point every post-restart session passes.
    Generic orphans get pi's abort convention (`isError` "Operation aborted (host restarted…)"); an
    old-format dangling ask gets the canonical decline + a re-ask hint (`details {answers:[],
    cancelled:true}`), so its card hydrates as the normal skipped record;
    **`answerQuestion(sessionId, toolCallId, result)`** — the `ask_user_question` reply path (see the
    `askUserQuestion` bullet); **`settleSessionsForShutdown(timeoutMs)`** — the polite half of shutdown:
    abort every streaming session and wait (bounded) so pi persists their "Operation aborted" tool results
    before `process.exit` (the launcher's SIGINT/SIGTERM handler awaits it; whatever misses the window is
    healed by the restart repair); `getSessionWorkspaceId(sessionId)` (the live session→workspace
    lookup the host's auto-rename hook keys on); `removeSession`/`disposeAllSessions`;
    **`removeWorkspaceSessions(workspaceId, cwd?)`** (the **archive teardown**: abort a streaming turn,
    `removeSession` every live session for the workspace, then delete pi's on-disk transcripts rooted at
    the worktree `cwd` — pi's `SessionManager` is append-only, so purge = `list(cwd)` then `rm` the files
    whose recorded `cwd` matches, never `rm -rf` the encoded dir since pi's cwd→dir encoding can alias
    distinct cwds; `cwd` omitted on a double-archive skips only the disk purge);
    `setSessionPublisher` + `setSessionManagerFactory` seams.
  - `oneshot` — one-shot LLM completions **without** an `AgentSession` (no tools/extensions/disk):
    `completeOnce(request)` picks a model from the shared runtime's authenticated set and dispatches a
    single `runtime.completeSimple()` — pi's canonical provider-agnostic request path, which resolves
    the model's auth itself (OAuth refresh included) and also serves providers that only implement
    `streamSimple` (extension-registered ones). `pickModel(tier)` = the model choice: `cheap` prefers a
    curated small/fast allowlist ∩ the authenticated set, else the cheapest by per-token cost; `default`
    = first available; `null` when nothing is authenticated. This is the primitive the `assist` tasks
    (workspace naming, PR drafting) run on — the only place model **dispatch** happens outside a session.
  - `webUiContext` — `createWebUiContext(sessionId)` builds the `ExtensionUIContext` pi calls (dialogs
    round-trip to the browser, fire-and-forget methods push, TUI-only members inert); `setExtUiPublisher`
    (server→client push seam), `resolveExtUi` (browser reply), `cancelExtUiForSession` (on dispose),
    `notifyExtUi`.
  - `askUserQuestion` — the host-owned **`ask_user_question`** pi custom tool (`createAskUserQuestionTool`,
    registered on every session via the `askUserQuestionExtension` factory in `extensions`), designed
    **ack + terminate** so a questionnaire survives host restarts: `execute` renders nothing and **awaits
    nothing** — it guards on `ctx.hasUI`, runs the pure `validateQuestionnaire`, then immediately returns
    the ack (`details {kind:"ack"}`) with **`terminate: true`**, ending the turn at the tool batch with no
    further LLM call. Nothing pends in memory, the transcript is complete and provider-valid the moment
    the ack lands, and the session is genuinely **idle** while the user thinks — restarts need no
    question-specific handling at all. The reply arrives over `session.answerQuestion` → the manager's
    `answerQuestion(sessionId, toolCallId, result)`: it vets the reply against the transcript with the
    pure **`assessAnswerability`** (unknown call / already answered / `not_awaiting` legacy-final results /
    **superseded** — a later free-form user message replaced the answer, so the card is terminal and a
    stale answer **fails loud**, never parks), then injects **`buildAnswersMessage`** — an
    **`ask-user-answers` custom message** (`ASK_USER_ANSWERS_CUSTOM_TYPE`, `details {toolCallId, result}`,
    text = the same `buildQuestionnaireResponse` envelope the blocking design fed the model; a partial
    submission lists its unanswered questions explicitly as declined) — via pi's public
    `AgentSession.sendCustomMessage({triggerTurn: true})`, which starts a new turn when idle and steers
    the current one when streaming. **Answering live and answering after a restart are the same code
    path.** The questionnaire is rendered **inline** in chat by `apps/web`'s `AskUserQuestionCard`
    (joined by tool name; lifecycle derived from the transcript — see the chat tools SPEC).
    **Rejected alternatives** (the one place these decisions are recorded): (1) the original **blocking
    design** — `execute` parked on an in-memory promise until the browser replied. A host restart
    destroyed the pending promise and left a dangling `toolCall` in the transcript; providers reject
    unpaired `tool_use`, so the chat **bricked** on every later prompt, and post-restart answers rotted in
    a held-answers map. The shutdown handler's synchronous `process.exit` made this deterministic, and
    questions block on human timescales — restarts during the window are the common case, not the edge.
    (2) A **suspended-session** variant (write the real result at answer time; tolerate the dangle while
    waiting) — needs two different answer mechanisms (resolve-blocked-promise live vs
    heal-file-then-attach post-restart), keeps a deliberately-invalid on-disk state every consumer must
    tiptoe around, and pi exposes no public turn-resume from a bare tool result anyway. (3) Bundling the
    community `@juicesharp/rpiv-ask-user-question` extension — its questionnaire UI is a live pi-tui
    component handed to the host via `ctx.ui.custom(factory)` (*code, not data*), unserializable over the
    WS bridge; and like every blocking ask-extension it inherits the restart hole. The LLM-facing contract
    (TypeBox schema, validation, envelope — mirroring rpiv's so the model behaves the same) stays
    re-implemented here so we own it and avoid the package's pi-tui/i18n peer deps.
  - `sessionRepair` — `repairDanglingToolCalls(sessionManager)`: the restart safety net (rationale under
    the manager bullet above). Pure over pi's `SessionManager` (compaction-aware via
    `buildSessionContext`; idempotent; appends at the leaf, where orphans sit by construction) —
    unit-tested against `SessionManager.inMemory`.
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
- **Public surface (barrel):** the manager operations (incl. `answerQuestion` +
  `settleSessionsForShutdown`) + `CreateSessionInput`/`CreateSessionResult` + `SessionEventPayload`;
  `configurePiRuntime`/`getPiRuntime`; `completeOnce`/`pickModel` +
  `OneShotRequest`/`OneShotResult`/`ModelTier`; the `webUiContext` seams; the `askUserQuestion` pure
  helpers (`validateQuestionnaire`/`buildQuestionnaireResponse`/`assessAnswerability`/
  `buildAnswersMessage`); `repairDanglingToolCalls`; the compiled-binary extension seam
  (`setBundledExtensions` + `BundledExtensions`/`BundledExtensionFactory`).
- **Allowed deps:** `@earendil-works/pi-coding-agent` (runtime); `@earendil-works/pi-ai` (types + test
  fixtures — dispatch goes through the shared `ModelRuntime`); `pi-web-access` + `pi-visualize` + `pi-spec-graph` +
  `pi-thinkrail-workflow` (the bundled extensions — loaded by path, never value-imported here; the
  compiled binary's value-imports live in `apps/cli`'s generated build module); `typebox` (the
  `ask_user_question` parameter schema);
  `contracts` (`PiEvent`/`Model`/`ThinkingLevel`/`ImageContent`/`SessionStats`/`SlashCommandInfo`/`ExtUi*`/
  `AskUserQuestion*`/`ProviderStatus*`); `@thinkrail/shared/jbcentral` (the proxy-URL predicate); Node.
- **Forbidden:** `host`; sibling features (the `cwd` is passed in, not looked up via `persistence`).

## Get right

- `prompt()` throws while a session is streaming → `promptSession` falls back to `steer()`.
- Errors arrive via the event stream + thrown methods, not a crash signal — wrap + forward.
- **A re-opened disk session is repaired before it is seeded** (`repairDanglingToolCalls` between
  `SessionManager.open` and `createAgentSession`) — never append to a session file behind a live
  `AgentSession`, its in-memory context would desync.
- **The ask tool never blocks and never holds state** — anything "pending" about a questionnaire must be
  derivable from the transcript alone (that's what makes restarts free); reply validity is
  `assessAnswerability`'s verdict, computed from `session.messages`, and rejections fail the WS request
  loud.
- Share one `ModelRuntime` (each session gets it as `createAgentSession`'s `modelRuntime`); give each
  session its own `SessionManager`; `dispose()` on removal.
- **A `pi` `Model` must never cross the wire raw** — its `baseUrl` carries the jbcentral proxy secret (and
  `headers` can carry auth). Every model-bearing frame (`model.list`/`model.default`, the `session.create`
  result, `SessionSummary.model`) goes through `toWireModel`; every inbound model ref (`session.create` /
  `session.setModel`) is **re-resolved** host-side by `{provider,id}` (`resolveWireModel`), never trusted.
  The wire type `WireModel = Pick<Model, id|name|provider|contextWindow|reasoning>` is an **allowlist** — it
  fails closed, so a future `Model` field can't leak by default (a unit test pins the exact key set).
- The slash-command list is derived from the **same three sources pi's rpc mode uses**
  (`extensionRunner.getRegisteredCommands()` + `promptTemplates` + `resourceLoader.getSkills()`).
- Dialog promises honor abort/timeout and are settled (+ dismissed in the UI) on session disposal — a
  bridged `uiContext` call must never hang.
