---
id: submodule-web-store
type: submodule-design
status: active
title: store — Zustand app state
parent: module-web
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The single Zustand store: connection status, projects/workspaces, one frontend-local workbench frame plus
per-workspace views/attention, terminal catalogs, and one **per-session chat runtime** for every live
`AgentSession` (so several chats stream concurrently).

## Boundary

- **Owns:** `appStore.ts` — connection/projects/workspaces state + setters. Connection state has two
  monotonic edges with different meanings: `setStatus("connected")` advances **`connectionGeneration`**
  for reconnect hydration, while **`welcomeGeneration`** advances only when one complete
  `server.welcome` snapshot lands. **`installWelcomeSnapshot(protocolVersion, projects, recentProjects,
  config?)`** installs protocol + both sorted project views + optional config + navigation repair and then
  advances that readiness edge in one Zustand write; route validation never observes a protocol-only or
  project-only intermediate state. `installProjectSnapshot` remains the project-only primitive for focused
  callers. **`projects`** is the open rail, while **`recentProjects`** is the last-opened-ordered set of every
  known open + closed project. **`applyProjectUpdated(project)`** is the one full-snapshot updater for
  `project.updated` pushes and authoritative project-mutation responses: it upserts/sorts Recents and either
  upserts/sorts the rail or removes the row when `closed === true`. Both actions reconcile stale navigation
  too: only when this client's selected project or active workspace belongs to a record no longer open,
  they clear the active workspace and select the first remaining project's Home (or `null` when none
  remain), while deliberately retaining every local workspace view/attention/resource-render/terminal/session
  map for lossless reopen. Other-client opens never steal navigation, and a background close never moves it.
  All project response call sites use the same updater, so the open and recent copies cannot drift.
  Explicit local transitions are **`selectMain()`**, **`selectProject(projectId, opts?)`**, and
  **`activateWorkspace(workspace)`**; each updates its coupled scope ids atomically, and there is no generic
  active-workspace setter that can split the invariant. **`workspaceSelectionHistory: string[]`** is this
  page's most-recent-first workspace attention: every ordinary, route-driven, and history-search activation
  moves its destination to the front, while project/main selection leaves the recency intact. It is not host
  state, URL history, or reload persistence. **`expandedProjectIds: Record<string, true>`** is the
  Projects rail's per-browser expansion — store-held (it must survive the rail's remounts and be writable by
  non-rail gestures) with **`toggleProjectExpanded(projectId)`** (the chevron), **`expandProject(projectId)`**
  (idempotent reveal: workspace creation / worktree attach / the active-workspace visibility rule), and
  `selectProject`'s **`{ reveal: true }`** option — the user-gesture variant that enters a project's home and
  expands its row in one write (rail row click, Welcome-screen open adoption); navigation restore and the
  workspace-removal fallback call it bare, staying expansion-neutral. Project-snapshot installs prune
  expansion to the open rail (a closed project's entry drops; identity-stable when unchanged).
  **`hydrateExpandedProjects(projectIds)`** seeds the set at boot from the `panels/projectExpansion`
  persistence module — the store itself still touches no storage: that module owns the localStorage
  mirror (host-qualified key, best-effort writes, untrusted reads) and subscribes to changes. Validated route restoration uses
  **`activateWorkspaceFromRoute(workspace, sessionId?)`**: it applies the same scope ids, advances the
  compatibility workspace navigation tick plus the current destination-group clock, and either installs a
  transient **`routeChatTarget`** stamped with both clocks or clears an older exact target. A workspace-only
  route carries no center-tab intent, so it retains existing browser-local attention; ordinary location
  derivation may then canonicalize it to an already-selected chat. **`routeChatTargetGeneration`** advances
  only on target installation (including same-workspace deep links), so consumption cannot duplicate the
  shell reconciliation pass. `selectCurrentRouteChatTarget` is the one check that the target's workspace and
  navigation stamp still hold. The shell's chat-reconciliation module validates/hydrates that exact target
  before ordinary locally placed-chat hydration; successful authoritative absence consumes it, while failures
  retain it for reconnect.
  The store owns no URL/history/storage access — `navigation` owns serialization and drivers. It also owns
  the **workspace lifecycle reactions** every client runs
  identically on the `workspace.created`/`updated`/`removed` pushes (no per-client optimism — the backend
  is authoritative): **`addWorkspace(ws)`** upserts a
  `workspace.created` snapshot by `id` (no-op if the project isn't listed yet — reconciles on its next
  `workspace.list` rather than seeding a partial one-row list; else add-if-absent / merge-if-present,
  idempotent with the creating client's own post-create re-list); **`updateWorkspace(ws)`** folds a
  `workspace.updated` snapshot in: **replace** the record by `id` in `workspaces[ws.projectId]`, carrying
  over only the list-computed `diffStats` aggregate (the snapshot is the persisted record, which has none).
  The push is authoritative, so a *replace* — never a merge: a merge could not clear an **optional field the
  host dropped** (`diffBase` re-pointed back to the creation base, the last `skillOverrides` entry removed),
  leaving the client labelling and keying reads off a value the host no longer has; a project never fetched or an id absent from its list is a **no-op** — the next
  `workspace.list` reconciles; **`applyWorkspaceRemoved(projectId, id)`** is the **entire** removal
  reaction (`removeWorkspace` drops the row + `clearWorkspaceState` drops its
  local view/attention/terminal maps and chat runtimes + recency drops the dead id,
  and **if it was this client's active workspace** → activate the most recently selected loaded workspace
  whose project remains open, even across projects; when none remains, `selectProject(projectId)` falls back
  to the removed workspace's Project Home; either active fallback gets the same neutral toast that reads right
  for both the initiator and an observer). A background removal never moves focus. Because the lifecycle event
  is shared but selection history is browser-local, each observing client restores its own prior context. The
  primitive **`removeWorkspace(projectId, id)`** just drops the row (unknown project/id is a no-op);
  **frontend-local workbench state** — one `workbenchFrame` carries the resource-free topology, geometry,
  singleton tools, and restore targets for this frontend surface; `workspaceViewsByWorkspace` carries each
  workspace's resource placements, order, and preview identities; `layoutAttentionByWorkspace` carries its
  selection, last focus, and navigation clocks; and local preset/limit preferences sit beside the frame.
  These are web-local types from `shell/layout`, not wire snapshots. `layoutDocumentsByWorkspace` is an
  identity-stable **derived projection cache** rebuilt only from frame + view for existing selectors/effects;
  it is neither persisted nor writable as authority. There is no accepted/projected pair, revision, mutation
  id, pending write, rollback queue, or conflict state.

  `applyLocalLayoutTransition(result)` is the one atomic installation boundary for pure layout results. A
  resource-only result updates one workspace view and attention. A frame result replaces the singular frame
  together with every retained workspace-view remap, so an explicit group removal or preset application can
  never leave a hidden workspace referencing a dead group. Components never splice group/tab arrays. Empty
  groups are valid frame state and closing a final resource does not delete them. `layoutProjectionEpoch`
  advances only when a local transition invalidates an uncontrolled pointer/resize draft.

  The store owns values and actions, never persistence. `shell/layoutState` validates and hydrates one
  endpoint/surface-qualified local document, subscribes to relevant state edges, and persists the normalized
  frame/views/attention/preferences. `hydrateLocalLayoutState` installs that document once. During the bounded
  compatibility release, the atomic import payload records `legacyLayoutImportAttempted[workspaceId]`, so
  reconnect cannot re-adopt the old snapshot. `clearWorkspaceTabs` removes the workspace view,
  attention, and associated local state when the workspace disappears. A page-lifetime
  `removedWorkspaceIds` tombstone rejects stale catalog/session/cache/workspace arrivals so an in-flight read
  cannot recreate it.

  **Browser-local resource render state** is keyed by workspace + canonical resource id, never embedded in
  the frame. Loaded file/diff content and ticks, editor modes, live chat runtimes, and resolved document
  markdown remain caches over their domain sources. Placement ids are stable within a workspace view; an id
  already owned by another semantic cache gets a collision-safe cache id. A virtual document is legal only
  when its local resource reference names a registered resolver plus durable source identity; `todo-plan`
  resolves by session to the live `PlanPane`. Arbitrary inline markdown cannot enter persisted layout state.
  An empty pre-hydration cache is never absence: a domain read must be authoritative for the current connection
  generation before reconciliation may prune a local reference.

  **Workspace-local attention** is selected tab per stable frame group, last-focused center group,
  last-focused auxiliary group, and group navigation clocks. Selection/focus never mutates the frame.
  Frame replacement reconciles each workspace's attention to a surviving group/tab. Navigation clocks advance
  at request time for local focus-changing opens and explicit re-selection; the stamp travels with the intent
  so acceptance does not count twice. A slow completion is discarded when newer navigation overtakes it.
  Preview identity is workspace-local per center group: `preview` replaces that group's slot and `keep`
  promotes one-way. A coalesced preview→keep gesture carries `claimPreview` on its single final intent, so no
  intermediate state persists. Arrangement-agnostic opens enter the store, but only shell layout integration
  resolves them against that workspace's last focus and commits local placement. Reopening an existing
  canonical resource changes attention only unless non-identity metadata changed. A late chat-title event may
  repair cache/history labels or a still-queued open, but cannot recreate a locally closed placement or steal
  focus. `syncLegacySelection` mirrors the selected resource into temporary editor/terminal compatibility
  state without becoming placement authority; its selector includes the matched cache/catalog key so identity
  repair retriggers the mirror.

  **`terminalsByWorkspace` remains a mirror of terminal domain state, never placement authority.** The host
  owns terminal existence keyed by `(workspaceId, tabKey)`; a workspace view locally references that key.
  `setWorkspaceTerminals` adopts `terminal.list` / `terminal.tabs`, retaining an omitted local tab only while
  reservation is in flight, removes dead references, and offers unrepresented catalog tabs to local placement
  reconciliation without changing frame geometry or attention. `addTerminal` mints a durable key and emits one
  local placement intent; captured group destination preserves contextual creation, while an uncaptured request
  resolves to bottom. Default-terminal reservation is a host-owned workspace-creation handshake and surfaces
  receive the resulting catalog entry. Confirmed close removes domain membership and every local reference;
  rejection preserves placement. There is no workspace-global `activeTerminal`: workspace attention decides
  which bodies mount, while host exclusive attach/takeover decides which client controls a PTY. The
  **per-session chat state** — `sessions: Record<sessionId, SessionRuntime>`, where a `SessionRuntime` holds
  one chat's `turns` (pi-canonical) / `toolResults` / `askAnswers` (the `ask-user-answers` replies keyed
  by tool call id — indexed by the reducer and hydration, never turned into bubbles; the sibling
  `subagent-completion` custom message is instead **appended as a `subagentCompletion` turn** — a
  detached subagent's terminal report is transcript-positioned, rendered by `chat`'s completion card —
  both narrowed by the shared contracts guards) /
  `currentAssistantId` / `attemptAssistantId` (scopes overflow removal to the attempt actually observed) /
  `isStreaming` / `model` / `thinkingLevel` / **`eventRevision`** (browser-local, incremented for every
  received Pi event; the compare-and-install fence for an authoritative transcript read) /
  **`syncedConnectionGeneration`** (which connected host generation the runtime's transcript was last read
  from) / `stats` / `commands` / `draft` and its **extension-UI state** (`pendingExtUi` (typed by
  `chat`'s `ExtUiDialogRequest`) + `extUiQueue` (overlapping dialogs FIFO so none orphans its server
  promise) + `extUiStatus` / `extUiWidget`). `openChatSession` creates a runtime; `closeChatRuntime` /
  `clearWorkspaceState` drop it; per-session mutators (`appendUserMessage` / **`appendErrorTurn`** / `setStats` / `setCommands` /
  `setCurrentModel` / `setThinkingLevel` / `setChatDraft` / `clearPendingExtUi`) take a `sessionId`.
  **`appendErrorTurn(sessionId, text)`** appends an `error` turn for a **rejected** turn-driving wire call
  (`session.prompt`/`steer`/`followUp`/`create`) — e.g. `prompt()` throwing "no API key" / a bad model —
  so a failed send lands in the chat instead of being swallowed; it carries no recovery action because Pi
  never accepted the missing turn. A *streaming* fault instead ends the run through
  **`reduceSessionEvent`** at `agent_settled`, using the host-projected final terminal metadata:
  `stopReason: "error"` carries Pi's `errorMessage`, and `stopReason: "length"` becomes an actionable
  truncation error — neither may become "✓ Done". That settlement-created error turn alone carries the
  web-local `recovery: "try-again"` marker; hydration gives the same marker only to its synthesized current
  final failure. `appendUserMessage` consumes every prior marker in the same optimistic write that adds the
  follow-on user turn, while `agent_start` consumes it for work begun by another client or a custom message.
  Thus the renderer can offer one ordinary `Try again.` send without parsing errors or leaving an actionable
  historical failure. `agent_end` is attempt-level and never clears `isStreaming`; settlement alone finishes
  retries, compaction, and queued continuations. The
  **compaction lifecycle is a first-class turn**: `compaction_start` appends a `compaction` turn
  (`running`), `compaction_end` settles the trailing running one in place (success → `done` +
  tokens-before/after from the typed `CompactionEndResult`, guarded — wire data is untrusted; `aborted`
  → `cancelled`; `errorMessage` → `failed` carrying the message, e.g. pi's one-shot overflow-recovery
  cap — a failed compaction must be visible, never swallowed) or appends the settled turn when no
  running one exists (reconnect mid-compaction). A successful `compaction_end` with `willRetry: true`
  additionally marks the turn `resuming` (pi continues the same run; settlement clears the flag — a
  settled transcript never claims ongoing work) and still removes the superseded assistant attempt. A
  successful live turn without a durable `summary` is also the chat integration's signal to read Pi's
  canonical compacted transcript; the reducer never guesses the cut boundary itself. The
  reducer relies on pi's guarantee that every emitted `compaction_start` is paired with a
  `compaction_end` (both success and failure paths emit it), the same trust every other event pair gets.
  Manual-command transport rejection uses one atomic store mutation: given the compaction-turn ids observed
  before the request, append a failed compaction turn only if none of the current ids is new. Thus a Pi failure
  already represented by `compaction_end` is never duplicated, while rejection before lifecycle begins is
  still visible on the same compaction surface.
  **`auto_retry_start` mirrors pi's live-context surgery**: pi's `_prepareRetry` trims the failed
  attempt's assistant message from the live context before re-running the turn (the retry re-streams it
  as a new message) while *keeping it in the session file*, so the reducer drops the superseded failed
  assistant turn (`removeSupersededAssistant`, the same rule as the overflow-compaction path) —
  otherwise the client renders the reply twice (frozen failed partial + retried copy). Hydration applies
  the same presentation rule to the persisted copy (`chat/hydrate.ts` hides retried attempts — an
  errored assistant followed by another assistant before any user message), so live and reloaded clients
  agree. Closed
  chats are reopenable: the workbench close command atomically removes local placement and invokes
  **`closeChatToHistory`**, which **keeps the runtime + host session alive**, records it in
  **`closedChatsByWorkspace`** (`ClosedChat[]`, per workspace, most-recent-first), and clears pending
  jump/history-open requests—but never a newer `routeChatTarget`, whose lifecycle belongs to navigation
  supersession and reconciliation. File, diff, and registered-document render caches follow the same local
  transition; after queued opens settle, shell reclaims only caches absent from local placement and queued
  intent. No peer can restore placement remotely. **`reopenChat(workspaceId, …)`** restores runtime/history
  membership in its captured workspace even after another workspace becomes active; shell adds placement to
  that workspace's locally chosen center group through the one transition path. **`noteClosedChats`** records
  disk-only sessions (from `session.list`) and peer-created sessions (from the `session.created` summary)
  there too—idempotently, skipping live/open sessions while refreshing an existing history row from a newer
  summary—so a chat that survived a host restart or was created in another frontend is reopenable without
  gaining local placement. **`deleteChat(workspaceId, sessionId)`** is the idempotent
  fold for both a confirmed local `session.delete` and the `session.deleted` broadcast: it atomically drops
  every tab the chat owns — its transcript, live plan page, and any dependent legacy document cache — plus
  its history row/runtime + skill baseline, records a page-lifetime tombstone, removes queued opens for the
  chat or its dependent documents, and queues a resource-removal intent. The shell layout integration
  removes every matching chat placement and session-backed plan reference through its pure mutation path,
  then reconciles local attention in the same transition. Until then the tombstone renders no body, so a
  stale local reference cannot recreate or hydrate the session. **`noteClosedChats`** and
  **`hydrateSession`** reject tombstoned session ids, so
  stale `session.list` / `session.getMessages` results already in flight cannot recreate a deleted chat;
  the tombstone survives workspace teardown because an older read can still settle afterward. The
  active-workspace hydration pass snapshots **`selectWorkspaceSessionIds`** before each `session.list`; when
  that authoritative read lands, **`reconcileWorkspaceSessions`** applies the same tombstone fold to every
  baseline id absent from the host result, repairing deletion events missed while disconnected without
  deleting a session created after the read began or advancing a user-navigation clock. Otherwise
  **`hydrateSession`** rebuilds browser-local
  runtime/render state from a host `SessionSummary` + converted transcript on connect; placement comes only
  from this surface's local workspace view, a local create intent, or an explicit reopen—peer-created/live
  sessions remain discoverable in history without opening a tab—the
  live summary's `lastSettlement` is authoritative when present; otherwise only a failure on
  the persisted transcript's final conversational message is current (historical `length` attempts followed
  by later work must not become stale warnings). Hydration is a no-op if a runtime already exists, so a
  live/ahead chat is never clobbered. **`reconcileSession(summary, hydrated, expectedEventRevision,
  connectionGeneration)`** is the separate authoritative path for an existing runtime after successful
  compaction or reconnect. It compare-and-installs only at the expected Pi-event revision, rejects a removed
  workspace/session or cross-workspace identity, replaces turns/tool results/ask answers/queue/model/thinking
  + streaming state, and preserves draft/stats/commands/extension UI/placement/history/focus. It marks the
  connected generation and advances the revision so two reads cannot regress one another. When the latest
  live compaction matches the durable record, its id + estimated-after count survive, and `resuming` survives
  only while the returned summary is still streaming. The
  pure **`reduceSessionEvent`** folds a `PiEvent` into a runtime; **`handlePiEvents` folds an ordered batch in
  one atomic store write while incrementing each affected runtime's revision once per event, even for a
  UI-ignored event**, because ignored still means it crossed the snapshot ordering boundary. The
  single-event **`handlePiEvent`** delegates to that same path so tests and non-wire callers cannot drift.
  Transport flushes a pending batch before delivering any later response or non-Pi push, preserving the
  revision fence's received-message ordering. **Only idle sends enter the transcript
  optimistically** (`ChatView.onSubmit` → `appendUserMessage`); the last-turn echo dedup below is
  sufficient precisely because nothing intervenes before the echo. A **streaming send (`steer`/`followUp`)
  never appends a turn**: its text lives in `queue` (folded verbatim from the host-projected
  `queue_update`, seeded from the summary at hydration), alongside the optional conservative `hasImages`
  aggregate that guards destructive text-only queue restoration; the turn lands only via pi's canonical
  user `message_start` —
  at its true position, converging live with hydrated. (Mirrors pi's own interactive mode; replaces the
  optimistic-append-for-everything model whose last-turn dedup missed whenever assistant content landed
  between the append and the echo — reproduced live as a duplicated, mispositioned queued bubble.)
  For the idle echo: an equal Pi `message_start` echo is ignored, while Pi's canonical expanded `<skill>`
  echo **replaces** the immediately preceding matching raw `/skill:<name> …` turn in place (same turn id),
  so live and hydrated transcripts both contain one canonical skill invocation; a malformed or mismatched
  block appends normally. **`handlePiEvent(event,
  sessionId)`** and **`applyExtUi(request)`** route by id via the `withRuntime` helper (a no-op for an
  unknown session). A `notify` at `error` level becomes an **`error`** turn (the same
  banner a session error gets — an extension crash must not read as chatter); every other level stays a
  `system` turn. Level is the *only* input, so the host's own error notifies ride the same road: the
  `Review send failed: …` that `host/handlers` publishes after a rolled-back send renders as that banner
  too. That is deliberate — a send that silently rolled back is exactly what a user must not scroll past. A **fire-and-forget** ext-UI frame (`notify`/`setStatus`/`setWidget`/`setTitle`)
  that has **no runtime to land in** is held in **`extUiOrphans`** (bounded, newest 64) instead of being
  dropped, and **both** runtime-installing actions — `openChatSession` *and* `hydrateSession` — drain that
  session's frames through the shared `replayExtUiOrphans` the moment its runtime exists. The admission
  test is **"no runtime"**, not "unknown session": every kind except `setTitle` is reduced by
  `withRuntime`, so a session that merely has a tab or a `closedChats` entry would pass a "do we know it"
  test and then be dropped by `withRuntime` — neither applied nor buffered. **No path builds that state
  today** — `closeChatToHistory` keeps the runtime, `closeChatRuntime` has no production caller, and both
  `openTab` sites that place a chat tab are guarded by its runtime already existing — so this rule is a
  guard, not a live fix, and it is pinned by seeding the store directly rather than through an action
  sequence no user can perform. It starts earning its keep the moment anything places a chat tab before
  its transcript is hydrated. `setTitle` is
  the one exception, and it decides for itself: `renameChat` renames the tab or the `closedChats` entry
  and reports whether it found the session **at all**, so only a title for a session in neither map is
  buffered. Admission falls out of the rename instead of being computed beside it — one walk over
  `tabsByWorkspace`/`closedChatsByWorkspace`, not the same two predicates twice. A **dialog** (`select`/`confirm`/
  `input`/`editor`) is never buffered: it is one half of a round trip whose other half may already have
  been answered by another client or lost to a host restart, so a replayed one would block the chat on
  a question nobody is waiting for. Why buffer at all: the host publishes what an extension does in
  `session_start` *before* it answers the RPC that installs the runtime, so an unbuffered client silently
  loses every status, title, widget and notify an extension sets at startup. This is **not only the
  create path** — pi re-emits `session_start` (`reason: "resume"`/`"startup"`) whenever the host attaches
  a session from disk, i.e. on every chat opened after a host restart, and those paths install the
  runtime through `hydrateSession`, not `openChatSession`. **Known gaps:** the 64-slot ring is one global
  list, and the host broadcasts ext-UI frames to every client, so a burst of sessions attaching at once
  can evict frames a client still needs; and nothing purges frames for a session that is deleted or whose
  workspace is removed. Per-session buckets plus a purge on those two events are the fix when either
  becomes real. The host-wide **`models`** list stays global (not per session), plus
  **`modelsRefreshing`** — the awaited `model.refresh` in-flight flag — and **`modelsFresh`**, the
  *provenance* of that list: true only while it holds the installed result of an awaited forced refresh,
  which `NewWorkspaceDialog` needs before it may substitute a model the catalog lacks. It lives here,
  beside the list, precisely **because `models` is app-wide**: `setModelsForProviderVersion` (a guarded
  `model.list` snapshot, whose handler answers from before the detached refresh it starts) **drops** it in the same write, so authority
  falls with the list any consumer replaced — held as one consumer's local flag it would outlive its
  subject and confirm a removed model that `create()` then rejects. `beginModelsRefresh` captures and
  returns the current provider version; `finishModelsRefresh(version, RefreshedModels|null)` lands only a
  matching reply (list + provenance + cleared in-flight flag in one write; `null` = failed refresh — keep
  the current list *and* its
  provenance, since nothing was installed). Provenance comes from the **host's** `complete`, never from
  "a reply arrived": the host caps how long it waits for pi, so a reply can carry the registry as it
  stands while the pass that would settle it still runs — such a list is installed (it *is* current) but
  drops authority, since concluding a model is gone from it is exactly the mistake. **`dropModelsFreshness`** is the third writer: authority is
  given up *without* replacing the list, which is what a consumer activating must do **synchronously** —
  a flag an earlier consumer set can otherwise straddle the activation and let an inherited list pass as
  this opening's own truth before its own `model.list` reply lands. **`providerVersion`** is the monotonic,
  data-free `provider.changed` generation observed from the host; **`noteProviderChanged()`** atomically
  increments it and clears `models`, freshness, and any old refresh spinner. Both `model.list` and
  `model.refresh` replies install through version-guarded store actions, so no picker or older async reply can
  offer a removed runtime generation. Transport owns the guarded re-read; the Providers settings pane observes
  the version and re-reads status. Other catalog transport work lives in `chat/useModelCatalog`, not here (the
  store→transport edge stays type-only). The **in-app login** state
  **`activeLogin: LoginState | null`** (type from `auth`) is **flat + session-less** (a login runs on the
  Welcome screen before any session exists — routing it through a session runtime would drop its frames):
  the pure **`foldLoginFrame`** reducer lives here (as `reduceExtUi`/`reduceSessionEvent` do — `auth` stays
  presentational), and **`beginLogin(loginId, providerId)`** opens the login (a no-op if a frame already
  created it — the frame can beat the `loginStart` response), **`applyLoginFrame(push)`** folds an inbound
  `provider.login` frame (creating `activeLogin` if the frame arrived first; ignoring frames for a different
  live login), **`clearLoginInput()`** drops the live input the instant a reply is sent (no double-submit),
  and **`clearLogin()`** dismisses it. The **settings surface** state — **`settingsOpen`** +
  **`settingsSection`** (a const-object enum: `Providers`/`Github`/`Appearance`/`Chat`/`Layout`/`Terminal`/`Templates`/`Privacy`) with
  **`openSettings(section?)`** (deep-links to a section, defaults to Providers) / **`closeSettings()`** /
  **`setSettingsSection()`** — lives here so the top-bar gear AND the Welcome provider warning open Settings
  to a section without prop-drilling through the shell. The **theme** state — **`theme: ThemeId`** (the
  host-owned selected opaque id; the themes module resolves visual fallback) with **`applyConfig(config)`**
  (folds the server-synced `AppConfig` in from
  `server.welcome` / the `settings.changed` broadcast) — lives here too; it's a **pure value only** (the
  theme-application side-effect is the shell's, keyed off `theme`), and defaults to
  `DEFAULT_CONFIG.theme` until the welcome arrives. **`composerGrowthLimit: ComposerGrowthLimit`**,
  **`customLayoutPresets: LayoutPreset[]`**, and **`analyticsEnabled: boolean`** ride the same `applyConfig`
  fold (host-owned, defaulted from `DEFAULT_CONFIG`) — the Chat, shared Layout catalog, and Privacy read
  sides. The instantiated frame, current/default preset id, and group limits are separate local values
  hydrated by `shell/layoutState`; `applyConfig` can never overwrite them. The
  **toast queue** — **`toasts: Toast[]`** (oldest-first) with **`pushToast(toast) → id`** / **`dismissToast(id)`**
  and the ergonomic **`toast.error/success/info(message, title?)`** helper (wraps `pushToast` so a non-React
  call site — a `.catch` in a fire-and-forget wire call — can fire one) — lives here so any surface can raise
  a transient notification; the `panels/Toaster` renders + times them out (errors persist until dismissed).
  `pushToast` **coalesces an identical live toast** (same variant/title/message — a retried failure returns
  the existing id instead of stacking a twin) and **caps the queue at 5** (oldest drop — the viewport doesn't
  scroll, so the newest must stay visible).
  It's the home for a **rejected wire call with no better place to land** (no chat tab to host an error turn),
  complementing `appendErrorTurn` (which handles the in-chat case).
  The host-wide **`templatesVersion: number`** counter + **`bumpTemplatesVersion()`** (increment) is a bare
  invalidation signal, the same shape as `fsChangesByWorkspace`'s `tick` below — **`panels/TemplatesSettings.tsx`**
  and **`chat/TemplateEditorDialog.tsx`** call it after a `template.save`/`delete`, and the Templates
  settings panel's own lists refetch off it (its `useTemplateList` fetch generation). It is deliberately
  NOT a freshness source for the composer's `/` menu — that fetch runs uncached on every menu open,
  since files also change outside the app where no in-app counter can see (see `chat/SPEC.md`'s Template
  slots section); the store holds only the counter, never fetches. The **live-refresh signal** —
  **`fsChangesByWorkspace: Record<workspaceId, { tick, paths, truncated }>`** with
  **`noteFsChanged(payload)`** (folds a `workspace.fsChanged` push: `tick` increments per frame;
  `paths`/`truncated` are the last batch) — panels select their workspace's entry and refetch on `tick`
  change (the store holds only the signal, never fetches; `applyWorkspaceRemoved` drops a removed
  workspace's entry). The **review slice** — **`reviewsByWorkspace: Record<workspaceId,
ReviewSnapshot>`** with **`setWorkspaceReview`** (a `review.get` read landing) and
**`applyReviewChanged`** (folds a `review.changed` push — full snapshot, idempotent; every client,
including a mutation's initiator, converges here — no optimism); `applyWorkspaceRemoved` drops the
entry; the pending-draft count is a selector (`selectReviewDraftCount`), never duplicated in
components. The **Skills-reload badge** rides the same tick without a separate signal:
  `noteFsChanged` also folds **`skillChangeTickByWorkspace: Record<workspaceId, tick>`** — the tick of the
  most recent *skill-relevant* batch, from the host-authored `payload.skillChange` semantic (`detected` for
  a concrete project-skill path, `unknown` for a genuinely pathless uncertainty, `none` for concrete
  non-skill churn). It is independent of the capped generic `paths`/`truncated` pair, so a large build cannot
  masquerade as a skill change and a skill event after the path cap is not lost; it stays *accumulated* so a
  later non-skill batch never clears it. A fresh watcher's synthetic startup nudge remains conservative
  `unknown`. Transport's centralized skill-load preparation awaits `workspace.watchReady`, folds a duplicate
  unknown fallback unless the watcher was already known ready (the event push may have died during
  reconnect), then captures the load's baseline tick. The newly loaded session stays clean; a real skill
  frame after readiness remains newer than the baseline. Each chat records
  **`skillsSyncedTickBySession: Record<sessionId, tick>`** = the tick it loaded skills at.
  It advances **only when resources are actually (re)loaded against current disk**: a fresh
  `openChatSession`, a disk-only `hydrateSession` attach, and **`markSkillsSynced(sessionId, syncedTick)`** on
  a successful reload (`markSkillsSynced` is **monotonic** — `Math.max`, so an out-of-order reload completion
  can't move the baseline backward — and a **no-op for a disposed session**, so a late completion can't
  resurrect an entry dropped by `closeChatRuntime`/`clearWorkspaceState`). A **live** `hydrateSession` restore
  reuses the server session's already-loaded skills (`getMessages` returns only the transcript, no reload)
  which the client can't date, so it advances **nothing** — the chat stays *conservatively stale* if a skill
  change has been observed, never falsely clearing. That
  `syncedTick` is the workspace tick captured at the **start** of the skill-loading round-trip, immediately
  after the shared `workspace.watchReady` preparation (`selectWorkspaceTick`, snapshot by the caller before
  `session.create`/`reloadResources`/`getMessages`), **not** at completion — so a skill change whose
  `fsChanged` frame folds while the load is in flight (which the load did not see) stays past the baseline
  and keeps the badge lit rather than being silently absorbed.
  The selector
  **`selectSkillsStale(state, workspaceId, sessionId)`** = `skillChangeTick > syncedTick` — store-derived
  (survives `ChatView`'s tab-switch remount) and per-session (a sibling/newer chat that loaded the current
  skills is not flagged; a reload clears only its own). Also **`updateFileTabContent(workspaceId, id, content,
  tick)`** — a `FileTab` carries the `tick` its content was loaded at, so `FilePane` detects staleness
  (`workspaceTick > tab.loadedTick`) across tab switches, and its diff twin
  **`updateDiffTabContent(workspaceId, id, original, modified, tick, loadedTarget)`** — a `DiffTab` follows the same
  staleness contract in `DiffPane`, in **two** dimensions: the fs tick and the review target the two sides were
  read against, written together so neither can outlive the content it describes. The transient
  A **`reveal-tool` `LayoutIntent`** is the arrangement-agnostic request to reveal/focus a singleton
  side tool; the shell layout integration consumes it and resolves the tool's current saved location.
  **`changesRequest`** and **`specRequest`** add an optional path/item target to that reveal and carry a
  browser-local request-time center destination without exposing layout concerns to feature views. Async
  resolution carries the local
  destination group's navigation-clock stamp captured at click time: if later attention overtakes it, the
  tool may still highlight the item but the stale completion cannot steal focus. Both intents are consumed
  after handling so remount/re-read cannot replay a structural open. Two fields remain necessary because a
  gitignored spec belongs to the spec graph, not the git-derived Changes view.
  **`specsByWorkspace`** +
  **`setWorkspaceSpecs`** hold each workspace's `spec.graph` snapshot (fetched by `panels`'
  `useWorkspaceSpecs`, kept fresh on the workspace fs tick) so
  the chat's turn divider can classify a written path as a spec off the very snapshot the Specs panel
  renders — one definition of "this file is a spec", via the **`specPathMatcher(nodes)`** selector; dropped
  with the workspace in `applyWorkspaceRemoved`. `setWorkspaceSpecs` **keeps the previous array identity when
  the re-read found no change** — most fs ticks touch no spec, and a fresh identity would invalidate
  `ChatView`'s matcher memo and re-derive every open chat's whole transcript about once a second.
  **`openDoc(tab)`** caches and places either a resolved **`DocTab`** or a **`PlanTab`** (`kind: "plan"`,
  id `${workspaceId}:plan:${sessionId}` — one page per chat, re-open focuses). Local placement persistence
  keeps only resolver kind + durable session identity, never cached content. `PlanPane` reads the host-owned
  plan live, so the page has no snapshot to go stale. **`DiffTab`** is a read-only Monaco diff of one
changed file over **one diff scope** (id `${workspaceId}:diff:${scopeKey}:${path}` — one tab per *(file,
scope)*: **the scope is part of a tab's identity**, because a tab's content must never change meaning
because the Changes tool's scope flipped underneath it; the tab carries its own `scope`, which is also what
`DiffPane` re-reads with, never the panel's current one).
**What a tab's identity fixes is *which scope* it shows — the kind, plus the sha for a commit scope.** A
branch-scope tab means "this file vs the workspace's **current** review target", and that target moving —
because commits landed on the branch, or because the user re-pointed it — is the same live-refresh contract
as the worktree changing underneath the tab, not a change of meaning; the target ref therefore does **not**
belong in the tab id (a branch name pins nothing — only a commit sha is immutable, and it is already in the
id). What it *does* require is that the tab re-read when the target moves: `selectDiffTabTargetRef` is that
second live dimension (see `panels/SPEC.md`'s live-refresh contract) — and that the tab **records the target
its content was actually read against** (`DiffTab.loadedTarget`, required, written by every content write).
Panes mount only while their resource is locally selected, so without that record a diff whose target moved
while it sat in the background would mount with the new target already in hand, conclude nothing changed, and show the *old*
target's diff under the new target's label; the cached value is what the mount compares against. Its
per-resource view state: `view` split|inline via
**`setDiffTabView`**, split the default; a markdown diff's `rendered` flag via **`setDiffTabRendered`**
(swaps raw lines for compiled documents — `DiffPane` offers it for markdown paths only); and
`ignoreWhitespace` via **`setDiffTabIgnoreWhitespace`** (Monaco's `ignoreTrimWhitespace`). All three go
through one internal `patchDiffRenderState(state, workspaceId, id, patch)` helper — locate-the-resource-cache
and merge lives once, so a new per-diff toggle is a one-liner, not another copy. Opened by `ChangesPanel`.
**`diffScopeByWorkspace`** + **`setDiffScope(workspaceId, scope)`** hold *what* each workspace's Changes
panel is diffing (read through **`selectDiffScope`**, which defaults to the shared, referentially stable
`BRANCH_SCOPE`); keyed **per workspace**, not app-wide like `changesView`, because a scope belongs to that
branch's review — a commit sha means nothing in another worktree — and dropped with the workspace in
`applyWorkspaceRemoved`. The transient **`chatLocationRequest`** — the history-search jump
  deep link; the requester activates the target project+workspace, the workbench shell integration
  opens/hydrates the target
  chat, `ChatView` consumes + clears — is **`ChatLocationRequest { workspaceId, projectId, sessionId,
  messageIndex, anchorText, navigation? }`**, set by **`requestChatLocation(req)`** (which captures and
  advances an already-hydrated destination group's local clock *before* switching workspaces, and sets `selectedProjectId` +
  `activeWorkspaceId` **atomically**, the same invariant `activateWorkspace` upholds, since the target chat
  can live in a different project/workspace than the one the search ran from — the caller
  `useHistorySearch.openMessage` loads the destination project's workspaces first when absent) and cleared
  by **`clearChatLocation()`**; the target's anchor resolves against the runtime's `turnIdByMessageIndex`
  (see `chat/SPEC.md`'s hydration bullet), falling back to the newest `anchorText` match when absent.
  The sibling transient **`historyOpenRequest { id, sessionId }`** — set by **`requestHistoryOpen(target)`**,
  cleared by **`clearHistoryOpen()`** — carries the shell's app-wide `Ctrl+R` to a chat, which opens (or,
  when already open, re-scopes) its history overlay; it goes through the store precisely because the chord
  fires outside the chat subtree entirely (see `shell/SPEC.md`'s "Global chords"). The target comes from
  **`selectHistoryTarget`** (the locally selected chat, else the workspace's newest chat) and the action
  atomically queues the workbench selection with the request; the request id correlates overtaken cleanup,
  and the intent carries the chat resource so a cache/placement id alias (including an id collision resolved
  by placement-only minting) still selects semantically. That selection deliberately does not focus the tab,
  because the mounted history query owns focus. The shell updates the group's local attention so the target
  body mounts and consumes the request without publishing a structural snapshot. The `EditorTab` (`FileTab`
  | `ChatTab` | `DocTab` | `DiffTab` | `PlanTab`) + `TerminalTab` + `ClosedChat` + `SessionRuntime` types.
  (Chat *render* types + renderers live in the `chat` module.) The pure context
  selectors in `selectors.ts` resolve the active `Workspace`, its owning project id, and the shell's context
  project from those canonical ids and collections; derived active-project state is never stored separately.
- **Public surface (barrel):** `useAppStore`; `selectActiveWorkspace`, `selectWorkspaceById` (the
  one lookup for "the workspace with this id" — `selectActiveWorkspace` is it applied to the active id, and
  `openFileInTab`/`ChatView` read the worktree root through it),
  `selectWorkspaceTerminals` (the host-owned terminal catalog; the layout visibility gate derives mounted
  identities from its supplied document + local attention, while host attachment remains exclusive per terminal),
  `selectActiveWorkspaceProjectId`, `selectHistoryTarget` + `HistoryTarget` (the shell's `Ctrl+R` routing
  target: the locally selected chat resource, or the workspace's newest chat otherwise),
  `selectContextProject`, the layout placement selectors (recursive center plus left/right/bottom auxiliary
  groups), `selectAttentionCenterTab` (the selected resource in local last center focus),
  `selectCurrentRouteChatTarget` (exact-chat intent only while its workspace and stamped navigation remain
  current), `selectSkillsStale`, **`selectDiffScope` + `BRANCH_SCOPE`** (what a workspace's
  Changes panel is diffing, defaulting to the shared branch-scope constant), **`selectDiffBaseRef`** (the ref
  it is measured against — the client-side mirror of the host's one resolution), **`selectDiffTabTargetRef`**
  (that ref *as an open diff tab's live dimension*: the target for a branch-scope tab, `""` for a
  commit/uncommitted one whose sides can't move — derived here, never re-assembled in a panel),
  `selectWorkspaceTick` (the sync-baseline snapshot), `selectWorkspaceSessionIds` (deduplicated local chat
  placement + history membership used as a reconnect-reconciliation baseline);
  `matchesWorktreePath` (line an agent-reported path — relative or absolute — up against a worktree-relative
  one; shared by the Changes deep link and the spec classifier. The suffix rule is for **absolute reports
  only** and is anchored at a separator: unanchored, `/wt/src/a-foo.ts` would match `src/foo.ts`; applied to
  relative reports, `module-b/SPEC.md` would match the *root* `SPEC.md`) + `specPathMatcher` (is a written
  path a spec-graph node?);
  `selectCatalogModel` (a model ref resolved against the **live** `models` list — a session's own `model`
  is the snapshot it was created with, so host-computed facts on it, today `thinkingLevels`, are read
  through this; callers fall back to the snapshot when the ref has left the catalog);
  `toast` (the fire-from-anywhere helper),
  `Toast` (type), web-local frame/workspace-view/attention selectors and atomic actions, resource render-state types
  (file/diff/virtual-document/plan/chat), `TerminalTab`, `ClosedChat`, `SessionRuntime` +
  `EMPTY_RUNTIME` (ChatView's pre-creation fallback), `ChatLocationRequest` (type), `reduceSessionEvent`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`Model`/`ThinkingLevel`/`SessionStats`/
  `SlashCommandInfo`/`ExtUiRequest`/`LoginPush`/`WorkspaceFsChangedPayload`/`LayoutPreset`/`AppConfig`/`ThemeId`;
  `DEFAULT_CONFIG` for the pre-welcome default; `PiEvent`/`LoginFrame`, **type-only**); `lib` (the shared
  path + array + canonical-message primitives — `normalizePath`/`isAbsolutePath` for
  `matchesWorktreePath`, `shallowEqualArrays` for the snapshot-identity guard, `userText` plus the skill
  invocation parser/matcher for user-message echo reconciliation; a leaf, so the edge adds no cycle); `chat`
  (`ChatTurn`/`ToolResultState`, **type-only**); `auth` (`LoginState`, **type-only**); `transport`
  (`ConnectionStatus`, **type-only**); `zustand`.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`, shell runtime (the web-local layout state edge is type-only), or transport runtime.
