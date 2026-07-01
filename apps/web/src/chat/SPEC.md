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
    result); `UserTurn`; `SystemTurn`; `TurnDivider` (+ the pure `turnDivider` deriver — a **round-end**
    summary rendered the instant a turn finishes, below its "✓ Done" marker (anchored at the round end,
    not the next user turn): elapsed time (user-submit → agent_end), tool-call count, a "files changed"
    chip); `RetryIndicator` (auto-retry countdown bar); `StreamIndicator` (the single streaming loader —
    typing-dots wave + a phase label, from the pure `streamStatus` deriver); `Markdown` (react-markdown +
    remark-gfm + shiki code blocks); `ToolCard`; the pointer-aware `useChatScroll` hook.
  - **Composer + cheap-win primitives** (also props-driven, **no store/transport**): `Composer`
    (send/steer/followUp/abort, `@`-mention completion, `/` slash-command menu, image paste/drop);
    `ModelSelector` (a pill opening a searchable `Command` list grouped by provider, no leading icon) +
    `ThinkingSelector` (a pill opening the six thinking levels — same trigger+popover shape as the model
    picker) (cheap win #1 — shared with `NewWorkspaceDialog`'s pre-session mode); both take
    an optional `container` so their popovers portal into a host Dialog (keeping the list scrollable under
    the Dialog's scroll lock); `SessionStatsBar` (cheap win #3); `ChatHeader`
    (arranges them); `ExtUiDialog` (renders pi's `select`/`confirm`/`input`/`editor` from the
    `pi.extensionUi` bridge).
  - **Tool-renderer registry** (`toolRegistry.tsx`) — `registerToolRenderer` / `getToolRenderer` /
    `getToolSummary` / `DefaultToolRenderer` + `ToolRenderer` / `ToolSummary` / `ToolRenderProps` /
    `toText`. **THE extension point.** A registration is a renderer (the card *body*) plus an optional
    `summary` (a pure one-liner for the collapsed header — e.g. a bash command, a file name).
  - **Built-in tool renderers** (`tools/`) — props-driven cards for pi's core tools: `bash` (terminal
    block), `read`/`write` (highlighted file via the shared `CodeBlock`), `edit` (removed/added line
    diff), plus the shared `CodeBlock` / `Collapsible` (long output folds behind a "Show all N lines"
    toggle) and pure `toolHelpers`. Registered (with their header summaries) via `registerToolRenderer`
    by `tools/register` (a side-effect import in `ChatView`, so it runs once when the chat module
    mounts). Unregistered tools still fall back to `DefaultToolRenderer`.
  - **`ToolCard`** pairs a tool call with its result and is **collapsed by default** — routine calls
    (bash/read/edit/…) stay folded so they don't clutter the chat; the header shows the tool name + its
    registered `summary` and a chevron, and clicking it reveals the body. Errors **auto-expand** so
    failures stay visible; a manual toggle wins thereafter.
  - **View types** (`types.ts`) — `ChatTurn` (user/assistant are pi `UserMessage`/`AssistantMessage`;
    `system` is a web-local notice; `retry` is a live auto-retry countdown) + `ToolResultState` +
    `ExtUiDialogRequest` (the reply-needing
    `ExtUiRequest` subset the store's `pendingExtUi` is typed by).
  - **Hydration** (`hydrate.ts`) — the pure **`messagesToRuntime(Message[])`** converter (the read-side
    counterpart of the event reducer): folds a session's pi-canonical transcript into `{ turns, toolResults }`
    so a reconnecting / second client rebuilds a chat on connect. No store/transport/shiki.
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
   `pi.extensionUi` channel).

## Streaming model

The `store` folds pi events into pi-canonical turns **per session** (`store.sessions[sessionId]`, routed by
the event's id so chats stream concurrently): the in-flight assistant turn **is** the latest
`assistantMessageEvent.partial` snapshot (replaced each update — not hand-accumulated; on `done`/`error`
the snapshot is `message`/`error`). Tool results are indexed by `toolCallId` in the runtime's `toolResults`
and paired with their `toolCall` block inside the assistant turn.

**One live indicator, always.** pi splits a run into several assistant messages (one per tool round) but
only sends *some* of them a terminal `done`/`error`, so a naive per-turn `streaming` flag can get stuck on
an earlier message and leave a stray cursor behind. The reducer therefore sweeps the flag whenever a **new**
assistant message starts *and* on `agent_end` (`clearTurnStreaming`), so at most one turn is ever flagged
streaming and none survives the turn. The **loader itself is a single footer** (`StreamIndicator`, rendered
as the Virtuoso `Footer` by `ChatView` while `isStreaming` and not mid-retry) — not a per-turn cursor — so it
can't be duplicated and it **fills the post-send gap** before the first token. `streamStatus(turns,
currentAssistantId)` names the phase from the active turn's last block: `working` (nothing visible yet) →
`thinking` → `running-tool` (with the tool name) → `writing`. `data-testid="stream-indicator"` +
`data-phase` make the loader lifecycle assertable.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
