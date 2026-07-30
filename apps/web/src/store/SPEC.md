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

The single Zustand store: connection status, welcome, projects/workspaces, the **workspace-scoped**
editor tabs + terminals (switching workspaces swaps both), and a **per-session chat runtime** for each live
`AgentSession` (so several chats stream concurrently).

## Boundary

- **Owns:** `appStore.ts` — connection/projects/workspaces state + setters, including the two atomic
  navigation transitions: **`selectProject(projectId)`** enters that Project Home (`selectedProjectId`
  set + `activeWorkspaceId` cleared in one write), while **`activateWorkspace(workspace)`** enters the
  workspace and selects its owner (both ids set in one write). There is no generic active-workspace setter
  that can split that invariant. It also owns the **workspace lifecycle reactions** every client runs
  identically on the `workspace.created`/`updated`/`removed` pushes (no per-client optimism — the backend
  is authoritative): **`addWorkspace(ws)`** upserts a
  `workspace.created` snapshot by `id` (no-op if the project isn't listed yet — reconciles on its next
  `workspace.list` rather than seeding a partial one-row list; else add-if-absent / merge-if-present,
  idempotent with the creating client's own post-create re-list); **`updateWorkspace(ws)`** folds a
  `workspace.updated` snapshot in: merge by `id` into `workspaces[ws.projectId]`, spreading over the
  existing record so the computed `diffStats` badge survives the push (the snapshot is the persisted
  record, which has none); a project never fetched or an id absent from its list is a **no-op** — the next
  `workspace.list` reconciles; **`applyWorkspaceRemoved(projectId, id)`** is the **entire** removal
  reaction (`removeWorkspace` drops the row + `clearWorkspaceTabs` drops its tabs/terminals/chat runtimes,
  and **if it was this client's active workspace** → `selectProject(projectId)` (shell falls back to its
  owning Project Home) + a neutral toast that reads right for both the initiator and an observer); the
  primitive **`removeWorkspace(projectId, id)`** just drops the row (unknown project/id is a no-op);
  `tabsByWorkspace` /
  `activeTabByWorkspace` (`openTab`/`closeTab`/`setActiveTab`/`clearWorkspaceTabs`, plus
  **`setFileTabView(id, view)`** — a markdown `FileTab`'s `view` (`"rendered"`|`"source"`) lives on the tab
  so the rendered↔source choice survives tab switches; absent = rendered);
  **`previewTabByWorkspace`** — the id of the workspace's **preview tab**, the one reusable slot a light
  open lands in (rendered italic; the gesture map per surface is `panels/SPEC.md`'s). It is keyed like
  `activeTabByWorkspace` *on purpose*: "at most one preview tab per workspace" is then structural rather
  than a rule each writer must remember, and the `EditorTab` union stays pure data (no `preview?` flag to
  sweep-and-clear on every open). Both openers carry a **`TabIntent`** (`"preview"` | `"keep"`):
  **`openTab(tab, intent)`** focuses an already-open id rather than duplicating it, and a `preview` open
  **replaces the slot's tab at its index** so the strip never reshuffles under the cursor, while a `keep`
  appends and releases the slot if it pointed there; **`setActiveTab(id, intent?)`** activates, and
  `"keep"` also promotes — **one-way**, so a plain activation (or a `keep` aimed at some other tab) never
  demotes a kept tab back to preview. The slot is released by `closeTab`, `clearWorkspaceTabs`, and
  `applyWorkspaceRemoved` (via `omitKey`), so a stale id can never outlive its tab. Alongside it,
  **`navTickByWorkspace`** counts **center-area navigations** per workspace — rendered by nothing, it exists
  so a slow read can tell it was overtaken. A click is instant and an `fs.readFile` is not, so
  `panels/openTabs.ts` records this count when it starts a read and **drops a `preview` that lands after the
  count has moved** (otherwise the file steals focus back from wherever the user went, and claims the preview
  slot from it) — and it takes that count at **request** time (`noteNavigation`, as the read starts), so a
  browse is ordered by when the user asked for it, not by when the host happened to answer. It is bumped
  *inside* every action that moves the active tab — `openDoc`, `setActiveTab`,
  `openChatSession`, `reopenChat`,
  `requestHistoryOpen`, `hydrateSession` **only when it actually takes focus** (a background
  auto-restore must not supersede a read the user is waiting on), and `closeTab` /
  `closeChatToHistory` **only when the closed tab was the active one** (closing some other tab in the strip
  leaves the user where they were; counting it would discard a browse in flight and the clicked file would
  never open) — plus **`noteNavigation(workspaceId)`**
  for an intent whose focus change hasn't reached the store yet (starting a chat, whose tab appears only once
  `session.create` returns). **`openTab` is the one deliberate exception and must stay uncounted**: it *is*
  the read completion being ordered, so counting it would make an earlier read's own commit look like user
  navigation and invalidate the later request — two browse clicks in a row would leave the FIRST click's file
  open. (Pinned by "every center navigation bumps the workspace's nav tick, and none of them bypass it" in
  `appStore.test.ts`, which asserts both branches of `openTab` leave the count alone.)
  Living here rather than in `panels` is the whole point: **no focus transition can
  bypass it**, which a module-local counter demonstrably did (it missed close/reopen/doc/new-chat).
  `clearWorkspaceTabs` releases the key with the rest. **Chat tabs and
  `DocTab`s never enter it** — a chat is an explicit creation with a live session behind it, and a
  `DocTab`'s content exists only in the store (no file backs it), so a silent replace would destroy it
  with nothing to reopen. There is deliberately **no keyboard shortcut**: gestures only.
  `terminalsByWorkspace`
  / `activeTerminalByWorkspace` (`addTerminal`/`closeTerminalTab`/`setActiveTerminalTab`); the
  **per-session chat state** — `sessions: Record<sessionId, SessionRuntime>`, where a `SessionRuntime` holds
  one chat's `turns` (pi-canonical) / `toolResults` / `askAnswers` (the `ask-user-answers` replies keyed
  by tool call id — indexed by the reducer and hydration, never turned into bubbles) /
  `currentAssistantId` / `isStreaming` / `model` /
  `thinkingLevel` / `stats` / `commands` / `draft` and its **extension-UI state** (`pendingExtUi` (typed by
  `chat`'s `ExtUiDialogRequest`) + `extUiQueue` (overlapping dialogs FIFO so none orphans its server
  promise) + `extUiStatus` / `extUiWidget`). `openChatSession` creates a runtime; `closeChatRuntime` /
  `clearWorkspaceTabs` drop it; per-session mutators (`appendUserMessage` / **`appendErrorTurn`** / `setStats` / `setCommands` /
  `setCurrentModel` / `setThinkingLevel` / `setChatDraft` / `clearPendingExtUi`) take a `sessionId`.
  **`appendErrorTurn(sessionId, text)`** appends an `error` turn for a **rejected** turn-driving wire call
  (`session.prompt`/`steer`/`followUp`/`create`) — e.g. `prompt()` throwing "no API key" / a bad model —
  so a failed send lands in the chat instead of being swallowed; a *streaming* fault instead ends the run
  via **`reduceSessionEvent`**'s terminal-error `agent_end` (last assistant `stopReason: "error"` → an
  `error` turn carrying its `errorMessage`, in place of the "✓ Done" marker). Closed
  chats are reopenable: **`closeChatToHistory`** removes a chat tab but **keeps its runtime + session
  alive**, recording it in **`closedChatsByWorkspace`** (`ClosedChat[]`, per workspace, most-recent-first);
  **`reopenChat`** restores the tab with full state (the runtime never left); **`noteClosedChats`** records
  disk-only sessions (from `session.list`) there too — idempotently (skips live/open/already-listed) — so a
  chat that survived a host restart is reopenable. **`hydrateSession`** rebuilds a runtime + tab from a host
  `SessionSummary` + converted transcript on connect — a no-op if a runtime already exists, so a live/ahead
  chat is never clobbered. The
  pure **`reduceSessionEvent`** folds a `PiEvent` into a runtime; **`handlePiEvent(event,
  sessionId)`** and **`applyExtUi(request)`** route by id via the `withRuntime` helper (a no-op for an
  unknown session). The host-wide **`models`** list stays global (not per session), plus
  **`modelsRefreshing`** — the awaited `model.refresh` in-flight flag — and **`modelsFresh`**, the
  *provenance* of that list: true only while it holds the installed result of an awaited forced refresh,
  which `NewWorkspaceDialog` needs before it may substitute a model the catalog lacks. It lives here,
  beside the list, precisely **because `models` is app-wide**: `setModels` (a `model.list` snapshot, whose
  handler answers from before the detached refresh it starts) **drops** it in the same write, so authority
  falls with the list any consumer replaced — held as one consumer's local flag it would outlive its
  subject and confirm a removed model that `create()` then rejects. `beginModelsRefresh` /
  `finishModelsRefresh(RefreshedModels|null)` are the atomic pair (finish lands the list, sets provenance,
  and clears the in-flight flag in one write; `null` = failed refresh — keep the current list *and* its
  provenance, since nothing was installed). Provenance comes from the **host's** `complete`, never from
  "a reply arrived": the host caps how long it waits for pi, so a reply can carry the registry as it
  stands while the pass that would settle it still runs — such a list is installed (it *is* current) but
  drops authority, since concluding a model is gone from it is exactly the mistake. **`dropModelsFreshness`** is the third writer: authority is
  given up *without* replacing the list, which is what a consumer activating must do **synchronously** —
  a flag an earlier consumer set can otherwise straddle the activation and let an inherited list pass as
  this opening's own truth before its own `model.list` reply lands. The transport work lives in
  `chat/useModelCatalog`, not here (the store→transport edge stays type-only). The **in-app login** state
  **`activeLogin: LoginState | null`** (type from `auth`) is **flat + session-less** (a login runs on the
  Welcome screen before any session exists — routing it through a session runtime would drop its frames):
  the pure **`foldLoginFrame`** reducer lives here (as `reduceExtUi`/`reduceSessionEvent` do — `auth` stays
  presentational), and **`beginLogin(loginId, providerId)`** opens the login (a no-op if a frame already
  created it — the frame can beat the `loginStart` response), **`applyLoginFrame(push)`** folds an inbound
  `provider.login` frame (creating `activeLogin` if the frame arrived first; ignoring frames for a different
  live login), **`clearLoginInput()`** drops the live input the instant a reply is sent (no double-submit),
  and **`clearLogin()`** dismisses it. The **settings surface** state — **`settingsOpen`** +
  **`settingsSection`** (a const-object enum: `Providers`/`Github`/`Appearance`/`Templates`/`Privacy`) with
  **`openSettings(section?)`** (deep-links to a section, defaults to Providers) / **`closeSettings()`** /
  **`setSettingsSection()`** — lives here so the top-bar gear AND the Welcome provider warning open Settings
  to a section without prop-drilling through the shell. The **theme** state — **`theme: ThemeId`** (the
  host-owned selected opaque id; the themes module resolves visual fallback) with **`applyConfig(config)`**
  (folds the server-synced `AppConfig` in from
  `server.welcome` / the `settings.changed` broadcast) — lives here too; it's a **pure value only** (the
  theme-application side-effect is the shell's, keyed off `theme`), and defaults to
  `DEFAULT_CONFIG.theme` until the welcome arrives. **`analyticsEnabled: boolean`** rides the same
  `applyConfig` fold (host-owned, defaults to `DEFAULT_CONFIG.analyticsEnabled` until the welcome
  arrives) — the Privacy toggle's read side. The
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
  workspace's entry). The **Skills-reload badge** rides the same tick without a separate signal:
  `noteFsChanged` also folds **`skillChangeTickByWorkspace: Record<workspaceId, tick>`** — the tick of the
  most recent *skill-relevant* batch (a `.claude|.github|.gemini|.pi|.agents/skills` path, via
  `isSkillPath`, or a truncated wildcard), *accumulated* so a later non-skill batch never clears it — and
  each chat records **`skillsSyncedTickBySession: Record<sessionId, tick>`** = the tick it loaded skills at.
  It advances **only when resources are actually (re)loaded against current disk**: a fresh
  `openChatSession`, a disk-only `hydrateSession` attach, and **`markSkillsSynced(sessionId, syncedTick)`** on
  a successful reload (`markSkillsSynced` is **monotonic** — `Math.max`, so an out-of-order reload completion
  can't move the baseline backward — and a **no-op for a disposed session**, so a late completion can't
  resurrect an entry dropped by `closeChatRuntime`/`clearWorkspaceTabs`). A **live** `hydrateSession` restore
  reuses the server session's already-loaded skills (`getMessages` returns only the transcript, no reload)
  which the client can't date, so it advances **nothing** — the chat stays *conservatively stale* if a skill
  change has been observed, never falsely clearing. That
  `syncedTick` is the workspace tick captured at the **start** of the skill-loading round-trip
  (`selectWorkspaceTick`, snapshot by the caller before `session.create`/`reloadResources`/`getMessages`),
  **not** at completion — so a skill change whose `fsChanged` frame folds while the load is in flight (which
  the load did not see) stays past the baseline and keeps the badge lit rather than being silently absorbed.
  The selector
  **`selectSkillsStale(state, workspaceId, sessionId)`** = `skillChangeTick > syncedTick` — store-derived
  (survives `ChatView`'s tab-switch remount) and per-session (a sibling/newer chat that loaded the current
  skills is not flagged; a reload clears only its own). Also **`updateFileTabContent(id, content,
  tick)`** — a `FileTab` carries the `tick` its content was loaded at, so `FilePane` detects staleness
  (`workspaceTick > tab.loadedTick`) across tab switches, and its diff twin
  **`updateDiffTabContent(id, original, modified, tick)`** — a `DiffTab` follows the same staleness
  contract in `DiffPane`. The transient **`rightTabRequest`** +
  **`requestRightTab(workspaceId, tab)`** are the ONE intent for "show a right-panel view" (`RightPanelTab`
  lives here, since the intent does): `RightPanel` watches that single field instead of inferring a flip from
  each path request, and **consumes** it (`clearRightTabRequest`) — an unconsumed flip would re-fire on every
  re-activation of the workspace, moving the tab the user has since chosen; which is what lets a divider chip reveal a view while merely expanding its own artifact
  list — no path picked yet. The transient **`changesRequest`** +
  **`requestChangesView(workspaceId, path)`** are a UI deep-link intent (a chat turn-divider asking the
  right panel to surface a file in its Changes view — highlight the row **and open its diff tab** when
  the file is in the current diff; a path no longer in the diff degrades to highlight-only); the panels
  watch it, scoped by workspace. It also carries **`navTick`**, the center-navigation count stamped **at the
  click**: `ChangesPanel` cannot resolve the reported path until `git.status` lands (and this chip is usually
  what *reveals* that view, so it is a fresh mount's read), so the click and the open sit a round trip apart.
  Whatever the user does with the center in that window is the later navigation and wins — an overtaken deep
  link degrades to the highlight rather than yanking focus off the tab they picked. Without the stamp the
  arriving open would mark *itself* as the navigation and always win. Its Specs
  twin **`specRequest`** + **`requestSpecView(workspaceId, path)`** **opens the
  rendered spec** and needs no stamp: it opens the reported path immediately, with no list to resolve first.
  Both path intents set `rightTabRequest` **in the same action**: the panel is never asked to surface a path
  in a view it was not also told to show.
  Two separate fields, never one: the panel that can show a *gitignored* spec is not the git-derived one, and
  that confusion is exactly the bug the split fixes. Both path intents are **consumed** by whoever handles
  them (**`clearSpecRequest`** / **`clearChangesRequest`**) — each opens a center tab, so a replay (a
  remount, a git-status re-read) would steal the user's tab. **`specsByWorkspace`** +
  **`setWorkspaceSpecs`** hold each workspace's `spec.graph` snapshot (fetched by `panels`'
  `useWorkspaceSpecs`, kept fresh on the workspace fs tick) so
  the chat's turn divider can classify a written path as a spec off the very snapshot the Specs panel
  renders — one definition of "this file is a spec", via the **`specPathMatcher(nodes)`** selector; dropped
  with the workspace in `applyWorkspaceRemoved`. `setWorkspaceSpecs` **keeps the previous array identity when
  the re-read found no change** — most fs ticks touch no spec, and a fresh identity would invalidate
  `ChatView`'s matcher memo and re-derive every open chat's whole transcript about once a second.
  **`openDoc(tab)`** opens
  (or refreshes + focuses) an ephemeral **`DocTab`** — inline rendered-markdown content, never backed by a
  file on disk (no fs re-read / source toggle) — used for on-demand snapshots like the plan-as-markdown
  export. **`DiffTab`** is a read-only Monaco diff of one
changed file vs the workspace's base branch (id `${workspaceId}:diff:${path}` — one tab per file;
`view` split|inline via **`setDiffTabView`**, split the default; a markdown diff's `rendered` flag via
**`setDiffTabRendered`** swaps raw lines for compiled documents — `DiffPane` offers it for markdown
paths only; opened by `ChangesPanel`). The transient **`chatLocationRequest`** — the history-search jump
  deep link; the requester activates the target project+workspace, `CenterTabs` opens/hydrates the target
  chat, `ChatView` consumes + clears — is **`ChatLocationRequest { workspaceId, projectId, sessionId,
  messageIndex, anchorText }`**, set by **`requestChatLocation(req)`** (which sets `selectedProjectId` +
  `activeWorkspaceId` **atomically**, the same invariant `activateWorkspace` upholds, since the target chat
  can live in a different project/workspace than the one the search ran from — the caller
  `useHistorySearch.openMessage` loads the destination project's workspaces first when absent) and cleared
  by **`clearChatLocation()`**; the target's anchor resolves against the runtime's `turnIdByMessageIndex`
  (see `chat/SPEC.md`'s hydration bullet), falling back to the newest `anchorText` match when absent.
  The sibling transient **`historyOpenRequest { sessionId }`** — set by **`requestHistoryOpen(target)`**,
  cleared by **`clearHistoryOpen()`** — carries the shell's app-wide `Ctrl+R` to a chat, which opens (or,
  when already open, re-scopes) its history overlay; it goes through the store precisely because the chord
  fires outside the chat subtree entirely (see `shell/SPEC.md`'s "Global chords"). The target comes from
  **`selectHistoryTarget`** (active chat tab, else the workspace's newest chat) and the action **activates
  that tab atomically** with the request — one `set`, because `CenterTabs` mounts one tab body at a time,
  so a request for an off-screen chat would never be consumed. The `EditorTab` (`FileTab` | `ChatTab` | `DocTab` | `DiffTab`) + `TerminalTab` + `ClosedChat` +
  `SessionRuntime` types. (Chat *render* types + renderers live in the `chat` module.) The pure context
  selectors in `selectors.ts` resolve the active `Workspace`, its owning project id, and the shell's context
  project from those canonical ids and collections; derived active-project state is never stored separately.
- **Public surface (barrel):** `useAppStore`; `selectActiveWorkspace`, `selectWorkspaceById` (the
  one lookup for "the workspace with this id" — `selectActiveWorkspace` is it applied to the active id, and
  `openFileInTab`/`ChatView` read the worktree root through it),
  `selectActiveWorkspaceProjectId`, `selectHistoryTarget` + `HistoryTarget` (the shell's `Ctrl+R` routing
  target: the active chat tab, or the workspace's newest chat when a file/diff/doc tab is active),
  `selectContextProject`, `selectSkillsStale`, `selectWorkspaceTick` (the
  sync-baseline snapshot; + the `isSkillPath` path predicate it shares with `noteFsChanged`);
  `matchesWorktreePath` (line an agent-reported path — relative or absolute — up against a worktree-relative
  one; shared by the Changes deep link and the spec classifier. The suffix rule is for **absolute reports
  only** and is anchored at a separator: unanchored, `/wt/src/a-foo.ts` would match `src/foo.ts`; applied to
  relative reports, `module-b/SPEC.md` would match the *root* `SPEC.md`) + `specPathMatcher` (is a written
  path a spec-graph node?);
  `selectCatalogModel` (a model ref resolved against the **live** `models` list — a session's own `model`
  is the snapshot it was created with, so host-computed facts on it, today `thinkingLevels`, are read
  through this; callers fall back to the snapshot when the ref has left the catalog);
  `toast` (the fire-from-anywhere helper),
  `Toast` (type), `EditorTab` (`FileTab`/`ChatTab`/`DocTab`), `TerminalTab`, `ClosedChat`, `SessionRuntime` +
  `EMPTY_RUNTIME` (ChatView's pre-creation fallback), `ChatLocationRequest` (type), `reduceSessionEvent`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`Model`/`ThinkingLevel`/`SessionStats`/
  `SlashCommandInfo`/`ExtUiRequest`/`LoginPush`/`WorkspaceFsChangedPayload`/`AppConfig`/`ThemeId`;
  `DEFAULT_CONFIG` for the pre-welcome default; `PiEvent`/`LoginFrame`, **type-only**); `lib` (the shared
  path + array primitives — `normalizePath`/`isAbsolutePath` for `matchesWorktreePath`, `shallowEqualArrays`
  for the snapshot-identity guard; a leaf, so the edge adds no cycle); `chat`
  (`ChatTurn`/`ToolResultState`, **type-only**); `auth` (`LoginState`, **type-only**); `transport`
  (`ConnectionStatus`, **type-only**); `zustand`.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`/`shell` or transport runtime.
