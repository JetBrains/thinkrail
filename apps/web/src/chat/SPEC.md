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
a future `packages/chat-ui`). Built-in tool renderers live in the child
[tools/SPEC.md](tools/SPEC.md).

## Rendering model — rows and progressive disclosure

The transcript is pi-canonical turns (`ChatTurn` in `types.ts`: user/assistant are pi messages; `system`,
`error`, `retry` are web-local notices), but the list renders **derived rows, not raw turns** — folding
spans assistant-message boundaries (pi emits one assistant message per tool round), so a per-turn item
model can't group. The pure **`deriveRows(turns, toolResults, isStreaming)`** (`rows.ts`) walks blocks in
order into rows; `ChatTurnView` dispatches on row kind:

- `user` / `system` / `retry` — 1:1 renderers. The retry countdown carries a `source` (`turn` =
  pi `auto_retry_*`; `summarization` = compaction/branch-summary `summarization_retry_*`, pi ≥0.81.1) —
  the flows can overlap mid-run, each keeps exactly one indicator (re-scheduling replaces, each source's
  end event clears only its own), and `RetryIndicator` labels them apart ("Retrying" vs "Retrying
  summarization"). **`ErrorTurn`** is a persistent tinted failure notice
  (provider/model error, or a rejected send) — **never folded**, so a failed turn can't look like
  nothing happened.
- `markdown` — a non-empty assistant text block (react-markdown + remark-gfm + shiki).
- `tool` — a **primary** tool call: the collapsible `ToolCard` frame (collapsed unless registered
  `defaultExpanded`; errors auto-expand; a manual toggle wins), or a `"bare"` renderer that owns its
  frame. A `"bare"` call on a dead message (`stopReason` aborted/error — pi never executes those calls)
  renders as errored rather than staying interactive forever.
- `activity` — a contiguous run of **routine** steps (thinking blocks + routine tool calls), merged
  across consecutive assistant messages in a round and broken by non-empty text, primary tools, and
  non-assistant turns. `ActivityGroup` renders it **collapsed by default** behind one header ("N steps ·
  bash ×2, read ×4"); expanded, steps are slim borderless rows that individually reveal the step's full
  renderer body. While the trailing run streams, the header is a **live ticker** (spinner + current
  step's summary), collapsing when answer text starts. A single-step run renders its step row directly.
  Errored *routine* steps get **no special treatment** (deliberate — agents often recover; `ErrorTurn`
  and primary error-auto-expand are the safety nets).
- `divider` — the round-end summary (`TurnDivider` + pure `turnDivider` deriver), anchored the instant a
  round ends: elapsed time, tool-call count, a clickable "files changed" chip.

Row/step ids are stable across streaming snapshots (first step's `toolCallId`, or message-anchored index —
pi appends, never reorders), so fold state survives re-derivation and virtualization: **every fold surface
(activity groups, step rows, `ToolCard`) records manual toggles in the shared `foldState` cache**
(`foldState.ts`, keyed by row/step id — the `AskUserQuestionCard` pattern, see tools/SPEC.md; deliberately
never evicted — growth is bounded by manual toggles). A manual toggle always wins — over auto-expand
defaults *and* over a virtualization remount.

## Extension point — the tool registry

`toolRegistry.tsx` is **THE extension point**; a tool has two decoupled sides joined by **tool name**:
the **capability** registers with the pi session server-side (custom tool or pi extension/skill), the
**presentation** registers here. A registration is:

- a **renderer** (the card body; `ToolRenderProps` carries `toolCallId`/`args`/`result`/`status`/
  `workspaceRoot`/`streaming` — enough to stay props-driven), plus optionally
- a **`summary`** — a pure one-liner for collapsed headers and activity-step rows,
- a **`chrome`** — `"card"` (default, the `ToolCard` frame) or `"bare"` (owns its frame; for
  interactive/primary tools like `ask_user_question`),
- **prominence metadata** — `prominence`: `"routine"` (default, incl. unregistered tools — folds into
  activity groups) or `"primary"` (escapes the fold; `"bare"` chrome implies it **unconditionally**, even
  over an explicit `prominence: "routine"` — a self-framed renderer can't live inside a fold's step
  rows, so a misregistration must not silently break the fold), and `defaultExpanded` (a
  primary card renders expanded once complete, e.g. `visualize`). Read through the single
  **`resolveProminence`** seam — where a per-user override map (settings) can plug in later.

Unregistered tools fall back to `DefaultToolRenderer`. Tools needing user input mid-run either route
through the extension-UI bridge (`pi.extensionUi` → `ExtUiDialog`) or — for a rich inline card — render
from their `toolCall` args and reply through **`ChatActions`** (see below). Worked example: the
`ask_user_question` flow in [tools/SPEC.md](tools/SPEC.md).

## Interaction seams

- **`ChatActions`** — a React context (provided by `ChatView`, `null` standalone): how a renderer talks
  **back** to the agent without importing store/transport. Today: `answerQuestion(toolCallId, result)` —
  it rejects when the host refuses (unknown/answered/superseded call), and the caller owns the failure UX.
- **`askState`** — the questionnaire lifecycle seam: the pure `deriveAskStates(turns, askAnswers)` +
  `AskStatesContext`/`useAskState` (provided by `ChatView`, `null` standalone). The ask tool is **ack +
  terminate** (its tool result is just an ack; the reply arrives later as an `ask-user-answers` message),
  so "answered / superseded / awaiting" is a fact about the transcript, not a tool status — derived once
  per runtime snapshot and consumed by the card via context, keeping it props-driven everywhere else.
- **Hydration** (`hydrate.ts`) — the pure `messagesToRuntime(TranscriptMessage[])` converter (read-side
  counterpart of the event reducer): rebuilds `{ turns, toolResults, askAnswers }` (a `HydratedRuntime`)
  from a persisted transcript so a reconnecting/second client renders identically to the live path (same
  `raw` result shape, same error-turn surfacing for `stopReason: "error"`). `custom` messages never
  become turns: known ones (`ask-user-answers`) index into `askAnswers`; unknown customTypes are
  ignored. No store/transport/shiki.
- **Composer & chrome** — `Composer` (prompt field + send/steer/followUp/abort, `@`-mentions, `/`
  commands, image paste/drop) plus its props-driven **slash-completion primitive** (filter/menu/caret +
  Up/Down, Enter/Tab, Escape), reused by `panels/NewWorkspaceDialog` so the two inputs cannot drift;
  `ModelSelector` + `ThinkingSelector` (also shared with `NewWorkspaceDialog`;
  optional `container` prop portals their popovers into a host Dialog), `SessionStatsBar`, `ChatHeader`
  (its `left` slot carries the plan strip; its **Skills** button is the presentational **`SkillsButton`**
  primitive — a `BookOpen` pill, badged when a skill dir changed on disk — also shared with
  `NewWorkspaceDialog` so the two triggers cannot drift), `ExtUiDialog`, and **`SkillsDialog`** (the **Skills manager**: a catalog
  grouped by source with **sticky section headers** — the first-party **ThinkRail** and **Pi** groups lead
  (above the All-plugins master, which governs only the plugin groups), then Personal / **a group per
  installed Claude plugin** / the repo's Project skills last — each with its admission verdict,
  project-trust, re-confirm-new, a **per-group on/off** toggle + an **All-plugins** master, and per-skill
  toggles. It runs in **two modes** via an optional `workspace` prop: chat (`skills.state`, per-workspace
  skill overrides, + a **Reload** that applies changes to this chat's session via `session.reloadResources`,
  disabled while streaming) or project (`project.skills`, per-project-baseline toggles, no session) — the
  latter reused by `panels` pre-session). All props-driven; behavior detail lives in the components' jsdoc.
- **Chat TODO plan** — the chat's `pi-todos` list surfaced **only in the chat** (engine:
  [[module-pi-todos]]; host read/write: [[submodule-server-todos]]):
  `useChatTodos` (the `todo.*` data hook — fetch + live `pi.event` refetch + edits + the add-nudge + the
  `openMarkdown` snapshot action), `TodoList` (loose items + named groups, add-row + an "open as markdown"
  button), `planMarkdown` (a pure `plan → markdown` compiler), and `ChatPlan` (`ChatPlanStripContent` +
  `ChatPlanContent` — a header strip that opens the plan in a `Popover` over the chat; `ChatView` composes
  the `Popover` anchored to the header, so the popup hangs flush under it at the chat's left edge). There
  is no right-panel Todo tab — the plan lives in the conversation. The "open as markdown" action compiles
  the current plan and opens it as an ephemeral `doc` tab (`store.openDoc`), rendered by the panels'
  `MarkdownPreview` — no file is written to disk.

## Boundary

- **Public surface:** the registry API (`toolRegistry`), the props-driven slash-completion primitive, and
  the renderers (incl. the presentational `Markdown` — GFM + shiki, no store/transport; the rendering is fixed but the **prose skin** is the
  caller's via an optional `className` — chat uses a compact bubble skin, `panels/MarkdownPreview` a
  reading-optimized document skin; code blocks size in `em` so they scale with the skin; a caller may
  also **extend** the render with extra `remarkPlugins` + `components`, e.g. the file view's GitHub
  alert callouts), the view types
  (`types.ts`,
  incl. `ToolResultState` + `ExtUiDialogRequest`), and `ChatView` (lazy-mounted by `panels/CenterTabs`;
  it wires `SkillsDialog` + the header Skills trigger, resolving the owning `projectId` from the store and
  reading the reload badge from the store selector `selectSkillsStale(state, workspaceId, sessionId)` —
  per-session and store-derived, so it survives the tab-switch remount; a successful reload calls
  `markSkillsSynced` to clear only this chat).
  **No `index.ts` barrel** — chat pulls **shiki**, so per the code-splitting exception imports stay
  **per-file**; the registry is importable from `chat/toolRegistry` **without** pulling shiki.
- **Allowed deps:** `contracts` (pi message/content-block types, **type-only**); `store` + `transport`
  (**`ChatView` only** — the app-integration edge); `react-markdown` / `remark-gfm` / `shiki` (via
  `lib/highlighter`); `mermaid` (**lazy, `tools/visualize` only**); `react-virtuoso`; `lucide-react`;
  `components/ui`; `lib`.
- **Forbidden:** value-importing any `pi` package; a **presentational** renderer importing
  `store`/`transport` (only `ChatView` may — keep the renderers reusable).
- **`ChatView`** is the one app-integration file: wires this session's runtime
  (`store.sessions[sessionId]`), the transport calls, the `ChatActions` + `AskStates` contexts, and the
  divider's "files changed" → `requestChangesView` deep link. A **rejected** send (`prompt`/`steer`/`followUp`)
  lands in the chat via the store's `appendErrorTurn` — never swallowed; *streaming* faults arrive as pi
  events instead.

## Streaming model

The `store` folds pi events into pi-canonical turns **per session**: the in-flight assistant turn **is**
the latest `assistantMessageEvent.partial` snapshot (replaced each update — not hand-accumulated). A
message's true terminal is **`message_end`**: the reducer adopts the final message (it carries
`stopReason`, how renderers spot dead tool calls) and clears the turn's `streaming` flag **there** — not
at `agent_end`, which for a tool-calling message arrives only after its tools ran. Tool results are
indexed by `toolCallId` in `toolResults`; `ask-user-answers` custom messages index into `askAnswers`
(never the turn list — the questionnaire card is their rendering). The view re-derives rows each render
(`deriveRows` is pure; `ChatView` memoizes) — stable row/step ids keep fold state across snapshots.

**One live indicator, always.** pi splits a run into several assistant messages, so the reducer sweeps
the `streaming` flag on new-message start and `agent_end` (at most one turn is ever flagged). The loader
is a **single footer** (`StreamIndicator`: typing-dots + a phase label from the pure `streamStatus`
deriver — `working` → `thinking` → `running-tool` → `writing`) — not a per-turn cursor — so it can't
duplicate and it fills the post-send gap. The activity fold's live ticker is a *status* line (spinner,
like a running card header), not a second loader. `data-testid="stream-indicator"` + `data-phase` make
the lifecycle assertable.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
- Keep this spec at **intent + boundary + invariants**; per-component behavior belongs in the
  components' jsdoc, per-tool detail in [tools/SPEC.md](tools/SPEC.md).
