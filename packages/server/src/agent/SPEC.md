---
id: submodule-server-agent
type: submodule-design
status: active
title: agent — in-process pi sessions
parent: module-server
depends-on: [module-contracts, module-pi-delegation, module-pi-subagents]
references: [module-spec-graph, central-integration]
tags: [v1, pi]
---

## Responsibility

The in-process `pi` engine: a current shared model/auth runtime generation for pre-session work and future
chats, the lifecycle of `AgentSession`s (one per chat tab, rooted in a workspace's worktree and retaining the
runtime generation they were created with), Pi resource/skill loading (including portable
cross-agent skill discovery + a pre-session skill catalog), the **extension-UI bridge** that turns pi's
in-process `uiContext` dialog calls into WS frames, the host-owned **`ask_user_question`** tool + its
answer-injection path, and the **restart repair** that keeps re-opened transcripts provider-valid.

## Boundary

- **Owns:**
  - `piRuntime` (the current shared `ModelRuntime` generation — pi's canonical model/auth facade for
    catalogs, credentials, availability, login/logout, and request dispatch). Sibling consumers use the
    `usePiRuntime()` callback to capture the current generation rather than receiving a mutable singleton;
    host boot initializes it before any model work, while later Central artifact changes prepare and atomically
    activate a fresh generation. Tests configure the factory before initialization. Every runtime is created
    with **ambient network OFF** —
    `allowModelNetwork: false` **plus a scoped `PI_OFFLINE` around construction** (pi 0.81 derives the
    runtime's ambient-network default from that env at construction; the option now gates only the
    create-time refresh — in 0.80.x it fed both; the scoped value is restored immediately, a user-set
    one untouched — pinned by `piRuntime.test.ts`): catalog reads stay local (builtins + models.json +
    the persisted models-store), because a network-enabled `refresh()` (pi 0.82 folded the old
    `reloadConfig()` into it) awaits remote pi.dev catalog
    checks with no timeout — on the `provider.status` and host-boot paths that stalls wherever
    egress is slow or blocked. The one deliberate opt-in to
    live catalogs is the single-flighted **`refreshCatalogs(runtime)`** (issue #98, mirroring pi's own
    `/model`) behind two triggers: a detached task from `model.list` only
    (`listAvailableModels` fires it, then serves the current snapshot — the picker read never awaits the
    network; broader triggers — `model.default`, host boot — were considered and declined) and
    **awaited** via `model.refresh` (`refreshAvailableModels`, the picker's freshness affordance: await
    the refresh, then serve the post-refresh snapshot **with `complete`** — `refreshCatalogs` resolves a
    `CatalogRefreshOutcome` saying whether the pass it waited on settled, and that verdict travels to the
    client as `RefreshedModels.complete`, because a capped wait can only promise a *current* list, not a
    settled one, and catalog authority must key on the difference). Per-call `refresh({ allowNetwork: true, force })`,
    where **`force` is the caller's intent, not a constant**: an *implicit* trigger (`model.list`, opening
    the picker) leaves it off and pi's **4h provider freshness throttle** decides whether anything is
    fetched, while a *user-initiated* refresh (the picker's Refresh row → `model.refresh({force:true})`)
    bypasses it — inside that window pi returns early **before issuing any request at all** (its
    `If-None-Match` revalidation included), so an unforced explicit refresh would fetch nothing at all. **Single-flight per runtime instance** (pi's
    `refresh()` doesn't dedupe concurrent calls) **keyed with the kind**: an implicit caller joins any
    pass, a forced caller never joins a throttled one (it would inherit the no-op) and instead queues
    behind it. The **15s budget** (pi's model-selector one) is applied **twice**, both on **unref'd**
    timers (must not hold a shutting-down host or a test process open): as `models.refresh`'s **abort**
    signal (a hung refresh must self-expire or single-flight would wedge) *and* as the ceiling on what a
    **caller awaits**, because the signal bounds neither pi's unsignalled `forceRefreshAvailability()`
    fan-out after it nor a forced pass queued behind a throttled one — without it one slow provider leaves
    every picker's refresh row spinning. A timed-out caller serves the registry as it stands (reporting
    `completed: false`) while single-flight keeps tracking the unbounded pass (so it cannot start a second concurrent refresh); failures emit only a closed generic/count warn log (never provider ids or errors) + are swallowed, never the picker's problem; **`PI_OFFLINE`**
    (pi's env convention) disables it — resolving as a *completed* pass, since with nothing fetchable the
    registry as it stands is the settled answer; the e2e webServer env and the manager's unit suite set it for
    hermeticity. The **provider-credential surface** over this runtime —
    `provider.status` + in-app login — lives in the sibling `auth` module (which consumes the shared
    `usePiRuntime` callback), **not** here.

    Candidate preparation takes only the reviewed opaque Central path set, builds a fresh runtime, applies the
    composition root's invariant generation initializer (the source-mode e2e host uses it for its gated fake
    providers), records that pre-opaque provider-id allowlist for `provider.status`, and then applies the opaque
    extensions once through PI's public headless loader. Thus auth never inspects or emits Central's provider
    configuration, while an add/remove/replace can never drop process-local provider registrations. The
    initializer must be configured before the first generation and runs for every candidate. The path is the
    only artifact fact this module receives;
    it never reads, parses, hashes, snapshots, logs, copies, or serves the file. Initializer/extension/loader/
    provider failures discard the candidate and collapse to a closed `load-failed` outcome; raw diagnostics
    never reach `pi.extensionUi`, the wire, logs, analytics, persistence, or snapshots. Auth owns file watching,
    coalescing, and stale-candidate rejection; agent only prepares and activates a generation.

    Activation changes the current pointer for pre-session reads and future session creation; it never mutates,
    drains, or recreates existing sessions. A live session keeps its original runtime generation. A disk session
    attached after activation resolves its persisted `{provider,id}` exactly against the new current runtime—
    missing is an error, and PI's `createAgentSession` fallback is never allowed to choose a different model.

    Every models **read** goes through **`settledAvailableModels(runtime)`** — pi's
    `getAvailableSnapshot()`, **never `getAvailable()`**: that one awaits `refreshAvailability()`, which
    returns the pending per-provider auth fan-out *or starts one*, all unsignalled — so reading through it
    would hand `model.list` (whose contract is to answer without touching the network), `model.default` and
    every inbound model-ref check an unbounded wait, and would escape the refresh deadline one line after
    applying it. The snapshot is what pi's last *settled* pass concluded (written at `create()`, after every
    `refresh()`, and on login/logout), and being the one read makes the picker, default, and model resolution
    agree within a generation.
  - `agentSessionManager` — sessions keyed by `session.sessionId` (each `Entry` also tracks its
    `workspaceId`), `createSession({ cwd, workspaceId, model?, thinkingLevel? })` → `createAgentSession(...)`
    with a per-session `SessionManager` **and a `buildSessionSettings(cwd)` settings manager** (the user's
    real settings + an in-memory `images.autoResize:false` override — never persisted — so the `read` tool
    sends image files **raw**, bypassing pi's photon/WASM resizer that the single-file binary can't bundle;
    the web UI downsizes user-attached images itself at attach time — `apps/web`'s `chat/imageAttachment`
    caps the long edge at 1568px — and the `imageGuard` extension below is the in-context second line of
    defense); a shared `registerSession` publishes each event
    tagged with its id + `bindExtensions({ mode:'rpc', uiContext })`. The event projection retains the
    final `agent_end` assistant's reported terminal metadata and attaches it to `agent_settled`, so the
    wire has one authoritative automatic-work terminal even when compaction/retry happens between those
    events; it forwards rather than re-derives pi's result. A `compaction_end` is separately projected to
    a **fresh allowlisted event**: its `result` carries only `tokensBefore` and optional
    `estimatedTokensAfter`, never pi's summary, entry id, usage, or extension details. The live entry retains
    that settlement in `SessionSummary.lastSettlement` for reconnect after Pi removed a failed attempt from its rebuilt
    context; a new `agent_start` exposes explicit `null` (no current terminal) so an older persisted failure
    cannot reappear mid-run, while disk sessions remain transcript-authoritative. A live summary also
    carries pi's queue snapshot (`SessionQueueState`, only when non-empty): `queue_update` fires only on
    changes, so this is the read-side seed that lets a client attaching mid-run render messages queued
    before it connected. Each queue lane also retains the complete content of browser-queued messages only
    while Pi reports the corresponding text entry pending. That transient mirror exists solely because Pi's
    destructive queue API returns text but drops image blocks; Pi's queue events remain authoritative for
    membership/order. The host projects only a conservative `hasImages` aggregate into summaries/events, so
    image bytes do not ride the ordinary read stream.
    New-session and pre-session entrypoints capture the current generation; operations on a live session use
    that session's retained runtime. `abort` remains available as the cancellation control path.
    `prompt`/`steer`/`followUp` (with images) /
    — **both `promptSession` and `followUpSession` resolve the delivery mode against the session's
    LIVE `isStreaming`, never the caller's belief about it**: `prompt()` throws mid-turn (so it falls
    back to `steer`), and pi's `followUp()` only *enqueues* into a queue that a run already in flight
    drains (so on an idle session it falls back to `prompt`, else the message parks forever — the way a
    `review.sendBatch` into a re-attached review chat marked its comments sent to an agent that never
    saw them) / **`clearQueueSession`** (Pi's `clearQueue()`: drains both queues but returns only text,
    while the host snapshots its reconciled transient mirror first and returns complete per-message text +
    images. Pi emits the emptying `queue_update`). Its optional text-only precondition rejects before
    touching Pi whenever either tracked lane has queued images; manual compaction uses that guard, while
    **`abortSession(..., true)`** snapshots/drains and synchronously signals abort in one manager operation,
    then waits for idle and returns the complete queue so Stop cannot race a continuation or lose images /
    **`removeQueuedSession(sessionId, kind, index)`** — per-item queue removal, which Pi's
    API lacks (queues are bare string arrays, `clearQueue` is all-or-nothing): drain via the complete-content
    path, drop `lane[index]` (out-of-range → `removed: null`, everything re-queued), and re-queue each keeper
    with its images in order (`steer()`/`followUp()` per lane — each re-queue emits its own `queue_update`, so
    clients converge by events alone). **No-loss guarantee:** if the run settled during the operation the
    re-queued keepers would park forever (Pi's queues only drain inside a run), so the idle case drains them
    through the same idle-delivery fallback as `followUpSession` — the first becomes a `prompt`, the rest
    steer into the run it starts; delivery timing may degrade across that race window, content is never lost
    (pinned by the idle-fallback unit test) —
    `setModel` / `setThinkingLevel` / **manual `compact` guarded per session** (a second overlapping request
    is rejected before Pi can overwrite its one compaction controller; an active Pi compaction also blocks
    entry) / `getSessionStats` (+ contextUsage) / `getSessionCommands` /
    `listAvailableModels` / **`clampThinkingForModel`** (pi's `clampThinkingLevel` for a `{model, level}`
    pair — `model.clampThinking`; the host owns it so the pre-session picker, `getDefaultModel`, and a live
    session all adjust effort identically) / `getDefaultModel` (the model + thinking a fresh session resolves to — settings
    default if available, else first available — so the New-Workspace dialog shows the exact pre-session
    model). **Models cross the wire as `WireModel` (never pi's raw `Model`):** `toWireModel` projects a
    `Model` onto the wire's **allowlist** (see `WireModel`) — so `baseUrl`, `headers`, extension/provider
    routing data, and any other field are excluded by
    default — and the inbound side re-resolves the ref by `{provider,id}` via `resolveWireModel` against
    **`settledAvailableModels`**: `createSession` uses the current generation, while `setModel` uses that live
    session's retained runtime. Therefore a model newly shown in the global picker can be unavailable to an
    older live chat and fails with a closed model-unavailable error rather than crossing generations. Pi uses
    `Model.baseUrl` verbatim, so a client's baseUrl
    is never trusted (blocks disclosure *and* arbitrary-URL injection). The **hydration read side** —
    `listSessions(workspaceId, cwd)` (live sessions
    **unioned with on-disk** ones pi persisted under `cwd`, live winning on id → `SessionSummary[]` tagged
    `live`; before treating the **detached** disk list as authoritative it strictly scans every transcript
    header and verifies pi returned every file, so an unreadable/malformed/skipped file rejects the read
    rather than masquerading as absent and being tombstoned by reconnect reconciliation. A registered live
    session's own exact `SessionManager.getSessionFile()` path is excluded from that disk preflight: its
    in-memory entry is already authoritative, and pi may truncate/rewrite that path while the host lists,
    so treating the transient physical state as a detached corrupt chat would blank every chat on reload) +
    `getSessionMessages(sessionId, workspaceId, cwd)` (re-opens a disk session into the manager if
    not live, first resolving any model named by the transcript exactly in the active process runtime and
    rejecting with a closed error when that named model is unavailable—never accepting PI's silent fallback
    for an existing model reference; legacy transcripts with no persisted model reference may use the
    configured default—then returns `{ summary, messages }` —
    `TranscriptMessage[]`: the pi-canonical subset **plus
    `custom` messages**, which carry the `ask-user-answers` replies the questionnaire card pairs by tool
    call id, **plus `compactionSummary`**, pi's durable marker for the messages compaction summarized away —
    kept precisely because pi's resolved transcript is all that survives, so dropping it would hand the
    client a chat that starts mid-conversation with nothing to explain the gap. Which roles those are is
    **not decided here**: the filter is contracts' `isTranscriptMessageRole`, shared with `history`'s index
    so the two cannot drift and shift `messageIndex`), plus **`ensureSessionAttached(sessionId, workspaceId, cwd)`** — the same single-flighted
    re-open with no transcript read, for a caller that only needs the session *promptable* again (the
    review send's follow-up into an existing chat). It answers **`false` only when the id names no transcript
    in that cwd** — the sole case a caller may recover from by starting a new chat — and **throws** on
    every other re-open failure, so a merely-unreadable session can never be mistaken for an absent one
    and silently forked; the disk half is what survives a host **restart** — and re-attaching runs
    **`repairDanglingToolCalls` (the `sessionRepair` sibling) BEFORE `createAgentSession` seeds its
    context**: a host death mid-tool leaves an assistant message with unpaired `toolCall`s, every provider
    rejects such a context (the chat would brick), and appending behind a live session would desync its
    in-memory state — so orphans are paired at the one choke point every post-restart session passes.
    Generic orphans get pi's abort convention (`isError` "Operation aborted (host restarted…)"); an
    old-format dangling ask gets the canonical decline + a re-ask hint (`details {answers:[],
    cancelled:true}`), so its card hydrates as the normal skipped record;
    **`answerQuestion(sessionId, toolCallId, result)`** — the `ask_user_question` reply path (see the
    `askUserQuestion` bullet); **`settleSessionsForShutdown(timeoutMs)`** — the polite half of shutdown:
    abort every streaming parent, dispose every hidden child (including background children whose parent is
    idle), include cascades already pending from concurrent removal, and wait for all of them under the one
    bound so pi can persist their "Operation aborted" tool results before `process.exit` (the launcher's
    SIGINT/SIGTERM handler awaits it; whatever misses the window is healed by the restart repair).
    `disposeAllSessions` remains the synchronous emergency stop, but registers its best-effort child cascades
    in the same pending set; `getSessionWorkspaceId(sessionId)` (the live session→workspace
    lookup the host's auto-rename hook keys on); `removeSession`/`disposeAllSessions`;
    **`removeWorkspaceSessions(workspaceId, cwd?)`** (the **archive teardown**: abort a streaming turn,
    then dispose every live session for the workspace **unconditionally** — bypassing the per-chat delete
    guard that `removeSession` enforces, so a chat whose recoverable delete is mid-trash cannot abort the
    teardown loop and strand its siblings — then delete pi's on-disk transcripts rooted at
    the worktree `cwd` — pi's `SessionManager` is append-only, so purge = `list(cwd)` then `rm` the files
    whose recorded `cwd` matches, never `rm -rf` the encoded dir since pi's cwd→dir encoding can alias
    distinct cwds; `cwd` omitted on a double-archive skips only the disk purge);
    **`deleteSession(sessionId, workspaceId, cwd)`** (mark it deleted before any await so an in-flight disk
    attach cannot register afterward; that tombstone also makes a retained live entry non-addressable to
    **every session command, including `session.dispose`, for the full delete transaction**, so another
    client cannot append a turn behind the pending trash move or destroy the rollback target. **The
    transaction is single-flighted per session id**: a concurrent second trash click (another tab/client)
    for the same chat joins the running transaction (or is rejected as unknown when a foreign workspace
    names the id) rather than starting a rival one — two owners of the shared tombstone would let the
    loser's failure roll it back mid-move and briefly re-open the chat — and **only the transaction that
    installed the tombstone clears it on failure**, so an earlier successful deletion's permanent tombstone
    survives a later spurious re-delete. Abort a live turn if needed but retain the live entry, resolve a
    live transcript from that session's own `SessionManager` (never a lossy directory listing), otherwise
    use the same strict disk lookup above, move the exact matching-cwd transcript to the OS trash via
    `trashFile`, then dispose the live entry and publish `SessionDeletedPayload` for client convergence;
    a newly created empty live chat whose reserved JSONL path has not materialized has nothing recoverable to
    trash and is disposed directly. Any lookup or trash failure throws, rolls back the tombstone it installed,
    restores command access to the same
    transcript/live entry, and publishes nothing; there is deliberately no permanent-unlink fallback behind
    a recoverable UI action);
    `setSessionPublisher` + `setSessionCreatedPublisher` (broadcast the initial `SessionSummary` after
    `createSession` registers a new host-owned session—not when an existing transcript reattaches—so peer
    frontends discover it without inheriting placement) +
    `setSessionDeletedPublisher` + `setSessionManagerFactory` seams.
  - `oneshot` — one-shot LLM completions **without** an `AgentSession` (no tools/extensions/disk):
    `completeOnce(request)` picks a model from the shared runtime's authenticated set and dispatches a
    single `runtime.completeSimple()` — pi's canonical provider-agnostic request path, which resolves
    the model's auth itself (OAuth refresh included) and also serves providers that only implement
    `streamSimple` (extension-registered ones). `pickModel(tier)` = the model choice: `cheap` prefers a
    curated small/fast allowlist ∩ the authenticated set, else the cheapest by per-token cost; `default`
    = first available; `null` when nothing is authenticated. This is the primitive the `assist` tasks
    (workspace naming, PR drafting) run on — the only place model **dispatch** happens outside a session.
  - `webUiContext` — `createWebUiContext(sessionId)` builds the `ExtensionUIContext` pi calls (dialogs
    round-trip to the browser, fire-and-forget methods push); `setExtUiPublisher`
    (server→client push seam), `resolveExtUi` (browser reply), `cancelExtUiForSession` (on dispose),
    `notifyExtUi`, `notifyExtensionError` (pi's `ExtensionError` → one client-visible `error` notify
    carrying extension + event + cause — the cause capped at 500 chars because `error.error` is
    remote-shaped, and the extension named by its **directory** when its file is an anonymous
    entrypoint (`SKILL.md`, `index.ts`), never "Extension SKILL.md failed"; a bare
    "An extension failed." is what made #277 unreadable from the UI alone). The manager's
    `bindExtensions({onError})` wraps it in `reportExtensionError`, which does **two** things the notify
    cannot: it writes one `warn` to the rotated host log carrying the **full** `extensionPath` and the
    extension's own `stack` (rehydrated onto an `Error` so it lands in the structured `err` field — the
    chat gets the short name, the log gets the unambiguous one, and a crash stays findable after the tab
    is closed), and it **gates the client push** on `entry.registered`, the explicit flag
    `registerSession` sets when it puts the entry in the map. The event path's `sessions.get(id) === entry`
    cannot be reused: `bindExtensions` runs inside `prepareSessionEntry`, *before* registration, so the
    stricter form would suppress the `session_start` failure #277 is about. Nor can *absence* from the map
    stand in for "not registered yet" — `disposeSession` deletes without leaving a tombstone, so a disposed
    entry is indistinguishable from an unregistered one, and a late error would be pushed at a client that
    can never drain it. The log is never gated (a superseded session's crash is still worth recording) and
    it attaches an `Error` **only when pi supplied a stack**: several of pi's own `emitError` sites omit it
    (`runner.js` message_end, `agent-session.js` command/`<runtime>`), and synthesising one there would
    record the *host's* stack — pointing the reader at `prepareSessionEntry` instead of the extension,
    which is the opposite of why the line exists.
    **Members split three ways, not two.** *Untranslatable* ones are inert no-ops and rightly so — they take a
    TUI `Component` factory a web host cannot render (`setFooter`, `setHeader`, `setEditorComponent`,
    `custom`, `setWidget`'s factory overload; the string-array overload **is** rendered).
    *Translatable* ones must behave: **`theme` is a real `Theme`** (`plainTextTheme`) whose every
    decorator returns its input unchanged. *Translatable but unimplemented* is the third group and is named
    here so the split does not read as exhaustive: `setEditorText` / `pasteToEditor` are forwarded to the
    host by pi's own rpc mode and a web composer could honour them; ours stay inert until something needs
    them. What separates the theme from that group is the cost of being inert — an unimplemented editor
    call loses one feature, an unimplemented theme kills the whole extension on its first line. `getAllThemes: []` / `getTheme: undefined` match pi's own
    rpc mode; `setTheme`'s `{success:true}` is a known lie, tracked separately — a web host has no TUI
    theme to switch to, so pi's rpc-mode form (`{success:false}`) is the honest answer.
    `plainTextTheme` subclasses pi's `Theme` and overrides `fg`/`bg`/`bold`/`italic`/`underline`/
    `inverse`/`strikethrough`/`getFgAnsi`/`getBgAnsi`; `getThinkingBorderColor` /
    `getBashModeBorderColor` stay plain only because pi routes them through `this.fg` — an inherited
    guarantee, so `webUiContext.test.ts` pins them explicitly. **`getColorMode` is the one member left
    answering for the terminal** (`truecolor`, from the constructor): pi's `ColorMode` is
    `"truecolor" | "256color"` with no "renders no colour" value, so no honest answer exists to give. It
    costs nothing while an extension colours *through* the theme — every such path returns plain text —
    and only bites one that reads the mode and then emits ANSI on its own, which is the unsanitised-bridge
    gap tracked outside this module. Its colour table exists **only** to satisfy
    the constructor signature: every method that would look a colour up in it is overridden, and the one
    member that still answers for the terminal reads the constructor's *mode* argument, not the table. A pi
    bump that changes the palette breaks the build as a *notice that the theme surface moved*, not as a
    defect.
    **Rejected alternatives** (the one place these decisions are recorded): (1) `{} as
    ExtensionUIContext["theme"]` — the #277 bug itself. It assumed the TUI members are unreachable in
    `rpc` mode, but `ctx.ui.theme` is called by the **extension**, not by pi's renderer, and pi's own rpc
    mode hands out a live theme. (2) An object literal implementing `Theme` structurally — impossible
    without a cast: `Theme` carries private fields. (3) A real `Theme` built from blank colours, no
    overrides — pi maps `""` to the *default-colour* escape (`\x1b[39m`), not to nothing, so status text
    would reach the browser as literal escape bytes. (4) Forwarding pi's exported `theme` singleton — it
    is a `Proxy` that throws `Theme not initialized` until `initTheme()` runs, and `initTheme` is called
    only from pi's own CLI entrypoints, never when pi is embedded via `createAgentSession`. Every
    embedder of pi-as-a-library hits this; an upstream fix would not reach us until a deliberate pi bump.
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
  - `imageGuard` — the oversized-image guard: an inline extension (`oversizedImageGuard`, one of
    `buildResourceLoader`'s shared factories) hooked on pi's **`context` event** (fired before every LLM
    call, live sessions included). **Anthropic-family only**: the caps are Anthropic's model-level rules,
    so the handler gates on the context's active model (`isAnthropicFamilyModel` — native
    `anthropic`/`anthropic-messages`, or a Claude model id through Bedrock/Vertex/aggregators; unknown
    model ⇒ no-op) and every other provider's image context passes through untouched. It sniffs each image block's pixel dimensions straight from the base64
    header bytes (PNG/JPEG/GIF/WebP — no codec, never strips what it can't sniff; **bounded work per
    pass**: only a 256KiB decoded prefix is ever materialized — a JPEG whose SOF lies beyond it sniffs as
    unknown, not stripped — and each block is sniffed exactly once per pass) and replaces any block
    violating a provider rule with a text note naming the violated rule plus a re-attach hint. Five
    rules, in order: the **provider-accepted media types** (`ACCEPTED_IMAGE_TYPES`, shared with the
    composer via `contracts` — pi forwards an image's media type verbatim, so a legacy `image/heic`
    block 400s the whole request; stripping it heals sessions poisoned before the composer refused such
    files); the **4.5MB encoded-base64 payload ceiling** (`IMAGE_MAX_BASE64_BYTES`, shared
    with the composer via `contracts` — pi's own headroom under Anthropic's 5MB API limit, compared
    against `data.length` since the wire carries base64, so it applies even to unsniffable formats); the **8000px per-side hard cap**; the **count-aware 2000px cap** once the
    whole context carries more than 20 images — stripping changes the very count that selects that cap,
    so 2000px violators are stripped **largest-first only until the survivors fit back under the
    threshold** (18 small + 3 at 2500px ⇒ one stripped, the other two stay legal under 8000px); and the
    **request-wide `REQUEST_IMAGE_BASE64_BUDGET`** (24MB of base64, headroom under Anthropic's 32MB
    per-request cap — several per-image-legal blocks can still overflow the whole request), enforced by
    stripping survivors **largest-first until the aggregate fits**. This is what un-bricks a session poisoned by an oversized image
    (history is re-sent every turn, so one bad image 400s forever): sessions are append-only and the host
    has no image codec (the autoResize tradeoff above), so the guard transforms the **outgoing context
    only** — session file and transcript stay untouched, and a stuck chat recovers on its very next
    message. The count-aware cap also degrades a raw >2000px `read`-tool image to a note instead of a
    brick once a session crosses 21 images. Pure core (`guardOversizedImages`, `imageDimensions`)
    unit-tested with hand-built header bytes.
  - `delegation` — ThinkRail's embedding of the portable **`pi-delegation`** core +
    **`pi-subagents`** layer ([[module-pi-delegation]], [[module-pi-subagents]]): binds what only
    the host knows — the delegation root under the data dir (`<dataDir>/delegation`),
    `scope = workspaceId`, and the manager's `liveParentContext` projection (`ParentContext`, core
    decision #23), including the exact `ModelRuntime` retained by that parent session. Existing
    parents and their children therefore stay on their runtime generation across a Central change,
    while parents created afterward project the new generation. The host-wide `getPiRuntime` resolver
    is passed as the core's dynamic fallback rather than captured at service creation. One
    `DelegationService` per workspace is cached (`delegationServiceFor`, synchronous — nothing awaits
    at bind time); `subagentsExtensionFor(workspaceId)` hands the bound service to the
    extension factory each session loads. Cascades: `removeSession`/`disposeAllSessions` fire
    `disposeSessionChildren` — `removeSession` returns that cascade, the **delete transaction
    awaits it before `publishDeleted`/resolving** (safe: the cascade carries its own swallow, so a
    failing child abort can never fail a delete whose transcript is already trashed), and workspace
    archival **awaits it per session** — plus every **pending cascade registered for the
    workspace** (`disposeSession` removes the entry from `sessions` at cascade *start*, so a
    concurrent archive would otherwise see no parent to await while a delete's or remove's child
    cascade is still running; every `disposeSession` cascade registers in a per-workspace registry
    the archive drains — PR #303 review finding + the concurrent half found in the same sweep,
    both test-pinned via a test-gated child turn, deterministic in both directions: red because a
    pre-fix archive `rm -rf`s in its synchronous prefix while the gate is provably closed, green
    because the archive's completion is await-chained behind the cascade. Deliberately **cascades,
    not delete transactions**: archival must stay unblocked by a delete wedged mid-trash — the
    recycle-bin step has unbounded latency and never touches the store; that independence is its
    own pinned behavior) — before `removeWorkspaceDelegation` (drops the service + deletes
    `delegation/<workspaceId>`), so the store is never deleted under a live child — hidden
    children never outlive their workspace.
    `readChildTranscript` serves `subagent.getTranscript` from the store by
    `(workspaceId, parentSessionId, childSessionId)` — the ids are wire strings that become path
    segments, so it rejects path-like values (separators, `..`; the handler additionally validates
    the workspace like every sibling read) — and returns the run's current registry `status`
    alongside the messages, built from the raw entries via pi's canonical projection
    (`buildSessionContext` — the same entry→message path a live `session.messages` takes) and
    filtered through contracts' shared `isTranscriptMessageRole` exactly like `getSessionMessages`
    (a private message-entry loop here once drifted: compaction is an entry *type*, not a message
    role, so a compacted child's transcript lost its `compactionSummary` marker — PR #303 review
    finding, test-pinned; absent after restart/dispose; wire meaning: [[module-contracts]]).
    A missing transcript throws `CodedError("SUBAGENT_TRANSCRIPT_NOT_FOUND")` — the **permanent**
    miss the web dialog stops polling on, named on the wire instead of pattern-matched from the
    message ([[module-contracts]] owns the code set; this is the agent module's one
    `@thinkrail/shared` import, mirroring `git`'s `CodedError` use).
    Children opting into extensions
    (`extensions: true` in their definition) get the **curated child set**
    (`childExtensionFactories` in `extensions`): the headless-search policy + `pi-web-access` +
    `pi-spec-graph` — deliberately not the parent's full set (rationale + the listed-children
    carve-out: core decision #25). Web-access reaches the child set via a **named bundled-seam
    field** (`BundledExtensions.webAccessFactory`) in the binary and a Bun `require` in dev — its
    raw third-party `.ts` must stay out of the strict tsc graph.
  - `extensions` — Pi resource wiring. Candidate generation loads the reviewed external Central path once
    through a headless `DefaultResourceLoader` to apply provider registrations, without inspecting it.
    `buildResourceLoader(cwd, settingsManager, getAdmission, excludedPaths, extraFactories?)` then resolves
    Pi's normal settings/package +
    `.pi` / `.agents` extension set, removes that exact opaque identity **before loading**, and explicitly loads
    the remaining paths: sessions use the provider objects already owned by their retained generation, so
    arbitrary Central factory/errors/UI cannot reach `pi.extensionUi`. The Central identity is always excluded
    from session discovery—even if the global artifact changes—so a session cannot mutate its generation.
    All other user extensions
    retain normal discovery. The loader then adds
    automatic **portable cross-agent skill aliases**, then loads the five bundled extensions — **`pi-web-access`**
    (`web_search` + `fetch_content`), **`pi-visualize`** (`visualize`), **`pi-spec-graph`** (the `spec_*`
    tools + its `before_agent_start` rule), **`pi-thinkrail-workflow`** (the workflow-router rule +
    workflow skills), and **`pi-todos`** (the `todo_*` tools + its skill). Existing personal aliases are Claude
    (`${CLAUDE_CONFIG_DIR:-~/.claude}/skills`), Codex (`${CODEX_HOME:-~/.codex}/skills`), Copilot
    (`~/.copilot/skills`), and Gemini (`${GEMINI_CLI_HOME:-~}/.gemini/skills`), **plus each installed Claude
    plugin's `skills/` dir** (read from `~/.claude/plugins/installed_plugins.json` — the resolved `installPath`,
    never a cache sweep, so stale versions and transitive `node_modules/**/skills` are excluded); project-root
    aliases are `.claude/skills`, `.github/skills`, and `.gemini/skills`. The pure
    **`isProjectSkillPath(relativePath)`** predicate is the one server-side definition used by the worktree
    watcher (injected through `host`): it recognizes those aliases plus Pi's native `.pi/skills` and
    `.agents/skills`, so capped filesystem batches carry truthful skill-change evidence without making
    `watch` depend on `agent`. The fixed project/personal alias roots are registered as candidate skill paths
    **whether or not they exist yet**, so a `loader.reload()` picks up one a branch switch / pull / clone
    creates mid-session (plugin dirs are the set installed at construction — a plugin added later
    needs a fresh session); classification still only counts dirs that actually exist. Still never arbitrary
    dot-directory scanning, plugin caches, commands, or nested downward discovery. Pi remains the parser:
    vendor-only macros/hooks/models/subagents/metadata are not emulated. First-name-wins precedence is
    Pi native/configured/shared → ThinkRail-bundled → personal aliases → project aliases, so a repo can
    never shadow your own or ThinkRail's skills; source metadata preserves truthful `project` / `user` scope.
    **Admission gate (`skillAdmission`):** committed **project-scoped** aliases are attacker-controlled for a
    clone and injected into the system prompt, so per-skill they resolve to `load` / `untrusted` /
    `pending-ack` / `disabled` from an **admission context** — the project's `trusted` + `acknowledgedSkills`
    (granting trust acknowledges only what's present, so a later pull/branch skill is `pending-ack` until
    confirmed) + `disabledSkills` / **`disabledGroups`** baselines (a group key = a plugin name, a source tier
    `project`/`personal`/`bundled`/`pi`, or the special `@plugins` — assigned per skill by `skillGroup`, matching
    `SkillCatalogEntry.group`), layered with the workspace's per-skill `skillOverrides` (the trust gate is
    checked before the toggle layer, so an "on" override can never un-gate an untrusted alias, and a per-skill
    `on` beats a group disable). `skillsGate` filters + relabels in one `skillsOverride`; only `load` skills
    reach the system prompt / `/skill:` list.
    The host resolves the context via the **`setSkillAdmissionResolver`** seam (keyed by `workspaceId`, fails
    closed); `buildResourceLoader` takes the resolver as a thunk and `skillsGate` re-resolves **both** the admission
    context (`getCtx`) **and** the live compatibility source set (fresh discovery) on every `loader.reload()`, so
    `session.reloadResources` picks up a mid-session trust grant, skill/group toggle, **or a newly-appeared alias
    dir** — and a late-appearing project alias is still classified + trust-gated, never slipping through as an
    unclassified load. Personal / bundled / pi-native resources are never trust-gated (only the enable/disable layer);
    the gate is scoped to the compatibility aliases (pi-native `.pi` / `.agents` project trust is unchanged).
    `listSkillCommands(cwd, admission)` reuses the same gated inputs through a short-lived skills-only
    `DefaultResourceLoader` (no model/session/transcript, no extension factories) for pre-workspace
    autocomplete, cached briefly per `(cwd, admission)`; **`listSkillCatalog(cwd, admission)`** is the Skills
    manager's unfiltered variant (every discovered skill + its `group` + `decision`) — driven with a workspace
    (via `skills.state`) or a project (via `project.skills`, current checkout, no overrides) — and
    **`listProjectAliasSkillNames`** is the notice's present-alias count. The full session loader supports
    **two modes**:
    - **Run-from-source (default):** `additionalExtensionPaths` pointing at the packages' raw `.ts`
      entries (pi's loader jiti-loads them — no value-import into our typecheck graph), resolved
      **lazily on first use** (never at module load: the resolve requires `node_modules`, which a
      compiled binary lacks). The workspace packages' `pi.skills` manifests aren't auto-discovered for
      file-path entries — their `skills/` dirs (`pi-spec-graph`, `pi-thinkrail-workflow`, `pi-todos`) are
      wired via **`additionalSkillPaths`**.
    - **Bundled launchers (compiled CLI binary and packaged desktop runtime):** the launcher awaits the
      **`registerBundledRuntime({ factories, skillsDir, trashHelpers, webAccessFactory })` seam** before the first session — the same bundled extensions as
      **value-imported default-export factories** (pi gives `extensionFactories` full API parity with path loading; what's lost —
      file-relative `baseDir`, per-reload re-evaluation — none of them use) plus a staged on-disk
      skills dir (pi reads `SKILL.md` via plain fs, so skills must live on the real filesystem). The
      seam also performs the **bundled-artifact pi registrations**: pi hides Node-only provider code behind
      bundler-opaque variable-specifier dynamic imports (so browser bundles can't reach `node:http`
      OAuth servers / the AWS SDK), which a single-file binary can't resolve at runtime — every OAuth
      sign-in died with `Cannot find module './openai-codex.js'`. pi ships static registration seams
      for exactly this, and we mirror pi's own binary entry (`pi-coding-agent` `dist/bun/cli.js`):
      **`registerBunOAuthFlows()`** (`@earendil-works/pi-ai/bun-oauth`) + **`setBedrockProviderModule(
      bedrockProviderModule)`** (`…/compat` + `…/bedrock-provider`). Both load via **dynamic literal
      imports inside the seam** — literal specifiers are statically bundled by both `bun build --compile`
      and the desktop server-runtime build, while dev (which never calls the seam) never loads the flow
      modules or the AWS SDK. Registration
      lands in the same `pi-ai` instance pi consults at login time because the catalog pins one exact
      `pi-ai` version repo-wide (one store entry → one bundled module instance). Chat trash has two
      artifact seams behind the same registration: the wrapper statically installs `@stroncium/procfs`'s
      `processMountinfo` parser because `trash`'s Linux path reaches it through a binary-opaque
      template-literal CommonJS `require`; and the launcher stages `trash`'s `macos-trash` /
      `windows-trash.exe` helpers to real executable paths and injects them as `trashHelpers`, because the
      package's internal `new URL(…, import.meta.url)` points inside `/$bunfs/` after compilation. The
      wrapper executes an injected helper on macOS/Windows and otherwise delegates to `trash`; source mode stays on
      `trash` entirely. No platform degrades to permanent unlink.
    The desktop server/factory bundle is staged with a `.ts` filename on purpose. PI uses that module
    extension to select its TypeScript source-runtime Jiti configuration with bundled virtual modules;
    Electrobun's ordinary flattened `.js` output selects built-Node aliases that do not exist inside the
    package and rejects the Central candidate. The filename is therefore a tested artifact seam, not a
    cosmetic build choice.
    In every mode, the optional Central artifact remains an external filesystem path loaded by PI's public
    Jiti seam; it is never bundled, staged, or copied into ThinkRail. Both modes append
    `extensionFactories`: a **headless-search policy** (a `tool_call` hook defaulting
    `web_search`'s `workflow` to `"none"`, since pi-web-access would otherwise open a browser curator our
    `rpc` host can't render), `askUserQuestionExtension` (registers the `ask_user_question` tool),
    `oversizedImageGuard` (the context-level image-size guard, see the `imageGuard` bullet), **and the
    caller's `extraFactories`** — per-session host bindings (the workspace-bound subagents extension),
    value-imported so dev and the compiled binary take the same path.
    Both session paths pass it as `resourceLoader`. `buildResourceLoader` stays internal; the seam +
    its types are on the barrel.
- **Public surface (barrel):** the manager operations (incl. `answerQuestion` +
  `settleSessionsForShutdown`) + `CreateSessionInput`/`CreateSessionResult` + `SessionEventPayload`;
  the runtime-generation facade (`usePiRuntime`, candidate prepare/activate, current generation id, and the
  closed `load-failed` outcome—no manager internals) plus `configurePiRuntime`/factory test seams and the
  pre-bootstrap `configurePiRuntimeGenerationInitializer` composition seam;
  `completeOnce`/`pickModel` +
  `OneShotRequest`/`OneShotResult`/`ModelTier`; the `webUiContext` seams; the `askUserQuestion` pure
  helpers (`validateQuestionnaire`/`buildQuestionnaireResponse`/`assessAnswerability`/
  `buildAnswersMessage`); `repairDanglingToolCalls`; `liveParentContext` + `readChildTranscript`
  (the delegation embedding); the skill catalog helpers
  `listSkillCommands(cwd, admission)` (filtered, pre-session autocomplete) / `listSkillCatalog(cwd, admission)`
  (unfiltered, the manager's `skills.state`) / `listProjectAliasSkillNames(cwd)` (present-alias count) /
  `isProjectSkillPath(relativePath)` (watch-classification predicate);
  `reloadSessionResources(sessionId)` (active-chat reload); the **`setSkillAdmissionResolver`** seam (host
  wires `workspaceId` → the admission context);
  the bundled-artifact seam (`registerBundledRuntime` +
  `BundledExtensions`/`BundledExtensionFactory`).
- **Allowed deps:** `@earendil-works/pi-coding-agent` (runtime); `@earendil-works/pi-ai` (types + test
  fixtures + **pure catalog helpers value-imported from the package root** — today exactly
  `getSupportedThinkingLevels` + `clampThinkingLevel`, data-only projections over `Model`; *dispatch*
  still goes through the shared `ModelRuntime`, never pi-ai's stream/complete — plus the `/bun-oauth` + `/bedrock-provider`
  + `/compat` subpaths, value-imported **only** inside `registerBundledRuntime`'s dynamic imports);
  `pi-delegation` + `pi-subagents` (the portable delegation runtime and Agent-tool composition,
  value-imported by the host embedding); `pi-web-access` + `pi-visualize` + `pi-spec-graph` +
  `pi-thinkrail-workflow` + `pi-todos` (the bundled extension set — parent sessions load the set through
  resource-loader paths or launcher factories; delegated children value-import `pi-spec-graph` and receive
  the named `pi-web-access` factory through the bundled runtime seam, with source-mode Bun `require` as the
  dev equivalent); `typebox` (the `ask_user_question` parameter schema); `trash` (the cross-platform OS
  recycle-bin implementation; called with globbing disabled and allowed to throw — never degraded to
  `unlink`); `@stroncium/procfs` (directly pinned solely for the compiled Linux trash parser inclusion seam);
  `contracts` (`PiEvent`/`Model`/`ThinkingLevel`/`ImageContent`/`SessionStats`/`SessionSummary`/
  `Session*Payload`/`SlashCommandInfo`/`ExtUi*`/`AskUserQuestion*`/`ProviderStatus*`); `log` (diagnostics +
  session-lifecycle debug traces); `persistence` (`dataDir` only, to root the host-owned delegation
  transcript store); Node.
- **Forbidden:** `host`; sibling features other than `log` and the narrow `persistence.dataDir` edge (session
  worktree `cwd` remains an input, never a persistence lookup); Central process/filesystem knowledge—the
  caller supplies only the desired opaque extension paths for a candidate.

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
- Share one **current** `ModelRuntime` for pre-session reads and new sessions. Every session receives and
  retains its generation as `createAgentSession`'s `modelRuntime`; give each its own `SessionManager` and
  `dispose()` it on removal. Old runtimes remain reachable only through old live sessions and become
  collectible with them; `AgentSession.reload()` is resource-only and never changes generations.
- **A `pi` `Model` must never cross the wire raw** — provider/extension configuration may carry secrets in
  `baseUrl`, headers, auth, or provider closures. Every model-bearing frame (`model.list`/`model.refresh`/`model.default`, the
  `session.create` result, `SessionSummary.model`) goes through `toWireModel` — the list paths share the
  one `readAvailableWireModels` read so the projection can't be bypassed by adding a caller; every inbound
  model ref (`session.create` /
  `session.setModel`) is **re-resolved** host-side by `{provider,id}` (`resolveWireModel`), never trusted.
  The wire type `WireModel = Pick<Model, id|name|provider|contextWindow|reasoning> + thinkingLevels` is an
  **allowlist** — it fails closed, so a future `Model` field can't leak by default (a unit test pins the
  exact key set). `thinkingLevels` is the one computed field: pi-ai's `getSupportedThinkingLevels(model)`
  mapped at the same choke point, so the effort picker renders pi's per-model support truth without the
  client re-deriving it.
- A live slash-command list is derived from the **same three sources Pi's rpc mode uses**
  (`extensionRunner.getRegisteredCommands()` + `promptTemplates` + `resourceLoader.getSkills()`). The
  pre-session catalog maps only `resourceLoader.getSkills()` through the same skill→command helper and
  applies the **same project-trust gate**, so New Workspace preview and a real session cannot disagree
  except for the accepted base-branch/current-checkout timing difference.
- Dialog promises honor abort/timeout and are settled (+ dismissed in the UI) on session disposal — a
  bridged `uiContext` call must never hang.
- **Prompt-template `/name` expansion** — typed-through references like `/name args` in a prompt ride
  the agent's default `expandPromptTemplates: true` (no agent code change). It expands from the
  session's **create-time template snapshot** — a template saved mid-session is **NOT** seen by an
  already-open session's typed-through path (pi passes unknown `/name` text through verbatim). The
  composer's `/` menu path is always fresh via `template.list` (see `templates/SPEC.md` freshness rule).
