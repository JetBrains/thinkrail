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
    `text`→`Markdown`, `thinking`→thinking block, `toolCall`→`ToolCard` paired with its result);
    `UserTurn`; `SystemTurn`; `Markdown` (react-markdown + remark-gfm + shiki code blocks); `ToolCard`.
  - **Tool-renderer registry** (`toolRegistry.tsx`) — `registerToolRenderer` / `getToolRenderer` /
    `DefaultToolRenderer` + `ToolRenderer` / `ToolRenderProps` / `toText`. **THE extension point.**
  - **View types** (`types.ts`) — `ChatTurn` (user/assistant are pi `UserMessage`/`AssistantMessage`;
    `system` is a web-local notice) + `ToolResultState`.
  - **App integration** — `ChatView` (react-virtuoso list + minimal composer); the **only** file here
    that touches `store`/`transport`.
- **Public surface:** the registry API (`toolRegistry`), the renderers, the view types, and `ChatView`
  (lazy-mounted by `panels/CenterTabs`). **No `index.ts` barrel** — chat pulls **shiki**, so per the
  code-splitting exception (as with `panels` / `components/ui`) imports stay **per-file**: `CenterTabs`
  lazy-imports `chat/ChatView`; the registry is importable from `chat/toolRegistry` **without** pulling shiki.
- **Allowed deps:** `contracts` (pi message/content-block types, **type-only**); `store` + `transport`
  (**`ChatView` only** — the app-integration edge); `react-markdown` / `remark-gfm` / `shiki` (via
  `lib/highlighter`); `react-virtuoso`; `lucide-react`; `components/ui` (`Button`); `lib` (`cn`).
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

The `store` folds pi events into pi-canonical turns: the in-flight assistant turn **is** the latest
`assistantMessageEvent.partial` snapshot (replaced each update — not hand-accumulated; on `done`/`error`
the snapshot is `message`/`error`). Tool results are indexed by `toolCallId` in `store.toolResults` and
paired with their `toolCall` block inside the assistant turn.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
