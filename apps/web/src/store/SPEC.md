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

- **Owns:** `appStore.ts` — connection/projects/workspaces state + setters, incl. the **workspace
  lifecycle reactions** every client runs identically on the `workspace.created`/`updated`/`removed`
  pushes (no per-client optimism — the backend is authoritative): **`addWorkspace(ws)`** upserts a
  `workspace.created` snapshot by `id` (no-op if the project isn't listed yet — reconciles on its next
  `workspace.list` rather than seeding a partial one-row list; else add-if-absent / merge-if-present,
  idempotent with the creating client's own post-create re-list); **`updateWorkspace(ws)`** folds a
  `workspace.updated` snapshot in: merge by `id` into `workspaces[ws.projectId]`, spreading over the
  existing record so the computed `diffStats` badge survives the push (the snapshot is the persisted
  record, which has none); a project never fetched or an id absent from its list is a **no-op** — the next
  `workspace.list` reconciles; **`applyWorkspaceRemoved(projectId, id)`** is the **entire** removal
  reaction (`removeWorkspace` drops the row + `clearWorkspaceTabs` drops its tabs/terminals/chat runtimes,
  and **if it was this client's active workspace** → `setActiveWorkspace(null)` (shell falls back to the
  project Welcome) + a neutral toast that reads right for both the initiator and an observer); the
  primitive **`removeWorkspace(projectId, id)`** just drops the row (unknown project/id is a no-op);
  `tabsByWorkspace` /
  `activeTabByWorkspace` (`openTab`/`closeTab`/`setActiveTab`/`clearWorkspaceTabs`, plus
  **`setFileTabView(id, view)`** — a markdown `FileTab`'s `view` (`"rendered"`|`"source"`) lives on the tab
  so the rendered↔source choice survives tab switches; absent = rendered); `terminalsByWorkspace`
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
  unknown session). The host-wide **`models`** list stays global (not per session). The **in-app login** state
  **`activeLogin: LoginState | null`** (type from `auth`) is **flat + session-less** (a login runs on the
  Welcome screen before any session exists — routing it through a session runtime would drop its frames):
  the pure **`foldLoginFrame`** reducer lives here (as `reduceExtUi`/`reduceSessionEvent` do — `auth` stays
  presentational), and **`beginLogin(loginId, providerId)`** opens the login (a no-op if a frame already
  created it — the frame can beat the `loginStart` response), **`applyLoginFrame(push)`** folds an inbound
  `provider.login` frame (creating `activeLogin` if the frame arrived first; ignoring frames for a different
  live login), **`clearLoginInput()`** drops the live input the instant a reply is sent (no double-submit),
  and **`clearLogin()`** dismisses it. The **settings surface** state — **`settingsOpen`** +
  **`settingsSection`** (a const-object enum: `Providers`/`Github`/`Appearance`) with
  **`openSettings(section?)`** (deep-links to a section, defaults to Providers) / **`closeSettings()`** /
  **`setSettingsSection()`** — lives here so the top-bar gear AND the Welcome provider warning open Settings
  to a section without prop-drilling through the shell. The **theme** state — **`theme: ThemeId`** (the
  host-owned active theme) with **`applyConfig(config)`** (folds the server-synced `AppConfig` in from
  `server.welcome` / the `settings.changed` broadcast) — lives here too; it's a **pure value only** (the
  `applyTheme` DOM side-effect is the shell's, keyed off `theme`), and defaults to `Theme.Dark` until the
  welcome arrives. The
  **toast queue** — **`toasts: Toast[]`** (oldest-first) with **`pushToast(toast) → id`** / **`dismissToast(id)`**
  and the ergonomic **`toast.error/success/info(message, title?)`** helper (wraps `pushToast` so a non-React
  call site — a `.catch` in a fire-and-forget wire call — can fire one) — lives here so any surface can raise
  a transient notification; the `panels/Toaster` renders + times them out (errors persist until dismissed).
  `pushToast` **coalesces an identical live toast** (same variant/title/message — a retried failure returns
  the existing id instead of stacking a twin) and **caps the queue at 5** (oldest drop — the viewport doesn't
  scroll, so the newest must stay visible).
  It's the home for a **rejected wire call with no better place to land** (no chat tab to host an error turn),
  complementing `appendErrorTurn` (which handles the in-chat case). The **live-refresh signal** —
  **`fsChangesByWorkspace: Record<workspaceId, { tick, paths, truncated }>`** with
  **`noteFsChanged(payload)`** (folds a `workspace.fsChanged` push: `tick` increments per frame;
  `paths`/`truncated` are the last batch) — panels select their workspace's entry and refetch on `tick`
  change (the store holds only the signal, never fetches; `applyWorkspaceRemoved` drops a removed
  workspace's entry); and **`updateFileTabContent(id, content,
  tick)`** — a `FileTab` carries the `tick` its content was loaded at, so `FilePane` detects staleness
  (`workspaceTick > tab.loadedTick`) across tab switches. The transient **`changesRequest`** +
  **`requestChangesView(workspaceId, path)`** are a UI deep-link intent (a chat turn-divider asking the
  right panel to surface a file's diff); the panels watch it, scoped by workspace. The `EditorTab`
  (`FileTab` | `ChatTab`) + `TerminalTab` + `ClosedChat` + `SessionRuntime` types. (Chat *render* types +
  renderers live in the `chat` module.)
- **Public surface (barrel):** `useAppStore`, `toast` (the fire-from-anywhere helper), `Toast` (type),
  `EditorTab` (`FileTab`/`ChatTab`), `TerminalTab`, `ClosedChat`, `SessionRuntime` + `EMPTY_RUNTIME`
  (ChatView's pre-creation fallback), `reduceSessionEvent`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`Model`/`ThinkingLevel`/`SessionStats`/
  `SlashCommandInfo`/`ExtUiRequest`/`LoginPush`/`WorkspaceFsChangedPayload`/`AppConfig`/`ThemeId`; the
  `Theme` value for the default; `PiEvent`/`LoginFrame`, **type-only**); `chat`
  (`ChatTurn`/`ToolResultState`, **type-only**); `auth` (`LoginState`, **type-only**); `transport`
  (`ConnectionStatus`, **type-only**); `zustand`.
- **Forbidden:** `server`/`shared`/`pi`; importing `panels`/`shell` or transport runtime.
