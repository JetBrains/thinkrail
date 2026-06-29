---
id: submodule-web-chat
type: submodule-design
status: active
title: chat — pi conversation UI primitives
parent: module-web
depends-on: [module-contracts]
tags: [v1, chat]
---

## Responsibility

The chat/agent conversation UI: **presentational React primitives** that render pi's **canonical
message / content-block model**, a **tool-renderer registry** (the extension point), and `ChatView`
(the app-integration layer). Hand-rolled — pi ships no web UI, and the official
`@earendil-works/pi-web-ui` (MIT, **Lit**, runs the agent in-browser / "Direct Mode") is the canonical
event→render *reference* we learn from but do **not** adopt (architecture + framework mismatch with our
host-runs-pi / typed-WS / React+shadcn model). Built so others can reuse/contribute (extraction-ready as
a future `packages/chat-ui`).

## Boundary

- **Owns:**
  - **Presentational renderers** (props-driven, **no store/transport** → reusable): `ChatTurnView`
    (dispatch by turn kind); `AssistantTurn` (walks an `AssistantMessage`'s `content` blocks **in order** —
    `text`→`Markdown`, `thinking`→an auto-expanding thinking block, `toolCall`→`ToolCard` paired with its
    result); `UserTurn`; `SystemTurn`; `TurnDivider` (+ the pure `turnDivider` deriver — between-turns
    orientation: elapsed time, tool-call count, a "files changed" chip); `RetryIndicator` (auto-retry
    countdown bar); `Markdown` (react-markdown + remark-gfm + shiki code blocks); `ToolCard`; the
    pointer-aware `useChatScroll` hook.
  - **Composer + cheap-win primitives** (M12, also props-driven, **no store/transport**): `Composer`
    (send/steer/followUp/abort, `@`-mention completion, `/` slash-command menu, image paste/drop);
    `ModelSelector` (a pill opening a searchable `Command` list grouped by provider, no leading icon) +
    `ThinkingSelector` (a pill opening the six thinking levels — same trigger+popover shape as the model
    picker) (cheap win #1, restyled at M14 — shared with `NewWorkspaceDialog`'s pre-session mode); both take
    an optional `container` so their popovers portal into a host Dialog (keeping the list scrollable under
    the Dialog's scroll lock); `SessionStatsBar` (cheap win #3); `ChatHeader`
    (arranges them); `ExtUiDialog` (renders pi's `select`/`confirm`/`input`/`editor` from the
    `pi.extensionUi` bridge).
  - **Tool-renderer registry** (`toolRegistry.tsx`) — `registerToolRenderer` / `getToolRenderer` /
    `DefaultToolRenderer` + `ToolRenderer` / `ToolRenderProps` / `toText`. **THE extension point.**
  - **Built-in tool renderers** (`tools/`) — props-driven cards for pi's core tools: `bash` (terminal
    block), `read`/`write` (highlighted file via the shared `CodeBlock`), `edit` (removed/added line
    diff), plus the shared `CodeBlock` / `Collapsible` (long output folds behind a "Show all N lines"
    toggle) and pure `toolHelpers`. Registered via `registerToolRenderer` by `tools/register` (a
    side-effect import in `ChatView`, so it runs once when the chat module mounts). Unregistered tools
    still fall back to `DefaultToolRenderer`.
  - **View types** (`types.ts`) — `ChatTurn` (user/assistant are pi `UserMessage`/`AssistantMessage`;
    `system` is a web-local notice; `retry` is a live auto-retry countdown) + `ToolResultState` +
    `ExtUiDialogRequest` (the reply-needing
    `ExtUiRequest` subset the store's `pendingExtUi` is typed by).
  - **Hydration** (`hydrate.ts`) — the pure **`messagesToRuntime(Message[])`** converter (the read-side
    counterpart of the event reducer): folds a session's pi-canonical transcript into `{ turns, toolResults }`
    so a reconnecting / second client rebuilds a chat on connect (M16). No store/transport/shiki.
  - **App integration** — `ChatView` (react-virtuoso list + `ChatHeader` + `Composer` + `ExtUiDialog`,
    wiring store + transport: model list / stats / commands / mentions / dialog replies). Reads **its own
    session's runtime** via `store.sessions[sessionId]` (falling back to `EMPTY_RUNTIME`) and addresses every
    mutator/command with that `sessionId`, so multiple chats coexist. The **only** file here that touches
    `store`/`transport` — including the turn-divider's "files changed" chip, which calls the store's
    `requestChangesView` to deep-link the right panel to a file's diff.
- **Public surface:** the registry API (`toolRegistry`), the renderers, the view types, and `ChatView`
  (lazy-mounted by `panels/CenterTabs`). **No `index.ts` barrel** — chat pulls **shiki**, so per the
  code-splitting exception (as with `panels` / `components/ui`) imports stay **per-file**: `CenterTabs`
  lazy-imports `chat/ChatView`; the registry is importable from `chat/toolRegistry` **without** pulling shiki.
- **Allowed deps:** `contracts` (pi message/content-block types, **type-only**); `store` + `transport`
  (**`ChatView` only** — the app-integration edge); `react-markdown` / `remark-gfm` / `shiki` (via
  `lib/highlighter`); `react-virtuoso`; `lucide-react`; `components/ui` (`Button`, `Popover`, `Command`);
  `lib` (`cn`).
- **Forbidden:** value-importing any `pi` package; a **presentational** renderer importing
  `store`/`transport` (only `ChatView` may — keep the renderers reusable).

## Extension model — adding a tool

A tool has two **decoupled** sides, joined by the **tool name**:
1. **Capability (server):** register it with the pi session — a pi **custom tool**
   (`createAgentSession({ customTools })`) or a packaged pi **extension/skill**. The agent then calls it
   and emits `tool_execution_*` tagged with `toolName`.
2. **Presentation (here):** `registerToolRenderer("<toolName>", MyToolCard)`. A `ToolRenderer` returns the
   card body; the header/status chrome is shared. Unregistered tools fall back to `DefaultToolRenderer`.
3. **Interaction (optional):** tools that prompt the user route through pi's extension-UI bridge (the
   `pi.extensionUi` channel, M12).

## Streaming model

The `store` folds pi events into pi-canonical turns **per session** (`store.sessions[sessionId]`, routed by
the event's id so chats stream concurrently): the in-flight assistant turn **is** the latest
`assistantMessageEvent.partial` snapshot (replaced each update — not hand-accumulated; on `done`/`error`
the snapshot is `message`/`error`). Tool results are indexed by `toolCallId` in the runtime's `toolResults`
and paired with their `toolCall` block inside the assistant turn.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
