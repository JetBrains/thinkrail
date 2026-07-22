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

- `user` / `system` / `retry` — 1:1 renderers. A **user** message carries a hover **copy button**
  (`copy-user-message`, the shared `Copy`→green-`Check` affordance reused from `JetBrainsAiCard`) placed
  absolutely 6px below the bubble, right-aligned to its edge, revealed on `group-hover` — absolute so it
  never reflows the transcript (it sits in the existing gap below). User messages only. **`ErrorTurn`** is a persistent tinted failure notice
  (provider/model error, or a rejected send) — **never folded**, so a failed turn can't look like
  nothing happened.
- `markdown` — a non-empty assistant text block (react-markdown + remark-gfm + shiki).
- **Long-message collapse (history):** `user` bubbles and `markdown` blocks longer than
  `MESSAGE_COLLAPSE_LIMIT` (300 chars, `messageCollapse.ts`) render collapsed to the first ~300 chars
  behind a reused-style **Expand/Collapse** toggle (`CollapsibleMessage` in `turns.tsx`, the
  `Collapsible` button styling), **except the thread's last text message** (`ChatView` passes
  `isLastMessage` for the last `user`/`markdown` row) which always renders full. Expanded state is
  per-message client view state via `useFold(id)` (kept while the thread is open, never persisted/sent);
  a long message auto-collapses once it stops being last, unless the user toggled it. Display-only
  re-layout — no wire/streamed-field change.
- `tool` — a **primary** tool call: the collapsible `ToolCard` frame (collapsed unless registered
  `defaultExpanded`; errors auto-expand; a manual toggle wins), or a `"bare"` renderer that owns its
  frame. A `"bare"` call on a dead message (`stopReason` aborted/error — pi never executes those calls)
  renders as errored rather than staying interactive forever.
- `activity` — a contiguous run of **routine** steps (thinking blocks + routine tool calls), merged
  across consecutive assistant messages in a round and broken by non-empty text, primary tools, and
  non-assistant turns. When **finished**, `ActivityGroup` renders it **collapsed by default** behind one
  header ("N steps · bash ×2, read ×4"); expanded, steps are slim borderless rows that individually
  reveal the step's full renderer body. While the run is **live** (trailing + streaming) it is
  **windowed** so the current action never gets buried under completed steps (`windowActivity`, `WINDOW
  = 4`): the last few steps render as rows, everything older folds into one **"N completed steps"** row
  (expand reveals all; the shared fold cache keeps it expanded across new steps until the user
  collapses), and the **current step** (the last visible row) is emphasized with the established
  `bg-hover` active-row tint (plus its running spinner) — no ticker line, no new visual treatment. A
  single-step run renders its step row directly. When streaming ends the group reverts to the finished
  collapsed header (emphasis gone). Errored *routine* steps get **no special treatment** (deliberate —
  agents often recover; `ErrorTurn` and primary error-auto-expand are the safety nets).
- `divider` — the round-end **completion line** (`TurnDivider` + pure `turnDivider` deriver), anchored the
  instant a round ends: one line — a circled accent **“Done”** badge (check + label, `bg-primary/15
  text-primary` rounded-full — existing accent, no new token) on the left, the divider rule filling the
  middle, then the metrics on the right (tool-call count · elapsed time · a clickable "files changed"
  chip). This **replaces the old standalone “✓ Done” line**: that turn-end `system` marker (the one
  carrying `endedAt`) no longer renders as its own row — `deriveRows` merges it into this line — while
  other `system` notices still map 1:1.

**Vertical rhythm:** the transcript's spacing is a hierarchy, applied by `ChatView`'s `rowTopGap(prev,
cur, next)` as the *lower* row's top padding (bottom padding stays 0, so a gap is exactly one value;
`TurnDivider` carries no margin of its own, and the assistant `markdown` block trims its **outer**
paragraph margins in `Markdown.tsx` — `[&>*:first-child]:mt-0 [&>*:last-child]:mb-0`, keeping the inter-
paragraph `[&_p]:my-sm` — so the box hugs its text and these values render *exactly*, not +8px). A
reasoning chunk (`markdown`) and the steps row (`activity`) directly under it form one group at **6px**;
**12px** separates one group from the next and sits **before the round's completion `divider` line**;
**40px** sets an agent turn off from the next message (and is the default for any unspecified row pair).
The first row gets 20px of top breathing, the last 20px at the bottom. Verified against a real agent
transcript (`@agent`), whose per-round row order is `markdown → activity → markdown → … → divider`
(the completion is the single `divider` row; its Done badge subsumes the former `system` marker).

**Agent-message width:** assistant content frames (`markdown` / `tool` / `activity` rows) are capped at
`max-w-[85%]` of the chat column, left-aligned so the ~15% slack falls on the right — the mirror of the
user bubble's right-aligned `max-w-[85%]` (same existing utility, no new token). User/system/error/
retry/divider rows are unaffected.

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
  commands, image paste/drop; a **follow-up chip row** of outlined pills sits directly above the input —
  clicking a chip submits its text as a user message (steer while streaming, else a fresh turn), the row
  hides only when there are no chips. Its `followUpChips` are a prop; `ChatView` fills them from the
  **mocked** `followUpChips.ts` — an "agent is asking" set + an idle-starter set. **TODO(real-followups):**
  the real source is structured follow-up/ask data on the wire (a contracts change, out of scope); we never
  parse the agent's prose. `selectFollowUpChips` is the single seam.) — one bordered container: the textarea on top with the model + effort
  pickers (left) and stop/send (right) along the bottom edge inside the same frame, the focus ring on
  the container via `focus-within`, `ModelSelector` + `ThinkingSelector` (shared with `NewWorkspaceDialog`;
  optional `container` prop portals their popovers into a host Dialog), `SessionStatsBar` (token/cost +
  context-window usage — **rendered by the persistent left-panel footer**, not the chat header, via
  `store.selectActiveSessionStats` (with a `MOCK_USAGE` fallback so it's always visible); still
  props-driven + reusable), `ChatHeader` (now extension **status
  lines only** — renders nothing when there are none, so no empty bar under the tabs), `ExtUiDialog`. All
  props-driven; behavior detail lives in the components' jsdoc.

## Boundary

- **Public surface:** the registry API (`toolRegistry`), the renderers (incl. the presentational
  `Markdown` — GFM + shiki, no store/transport; the rendering is fixed but the **prose skin** is the
  caller's via an optional `className` — chat uses a compact bubble skin, `panels/MarkdownPreview` a
  reading-optimized document skin; code blocks size in `em` so they scale with the skin; a caller may
  also **extend** the render with extra `remarkPlugins` + `components`, e.g. the file view's GitHub
  alert callouts), the view types
  (`types.ts`,
  incl. `ToolResultState` + `ExtUiDialogRequest`), and `ChatView` (lazy-mounted by `panels/CenterTabs`).
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
like a running card header), not a second loader. **The footer is suppressed for the `thinking` phase**
(`ChatView` nulls the footer status): the reasoning activity row already shows a "thinking" spinner +
label, so a "Thinking…" footer would double it — one state, one indicator. Every other phase keeps the
footer (its label — "Running bash…"/"Writing…"/"Working…" — is unique, and the working signal is never
lost). `data-testid="stream-indicator"` + `data-phase` make the lifecycle assertable.

## Get right

- Renderers are **theme-only via CSS-var token utilities** (no raw hex / inline `style`) — that's what
  lets the primitives wear any token theme, the key to reuse.
- Keep presentational components **props-driven** (not store-bound); only `ChatView` wires the app. This
  is the seam for extracting a standalone `packages/chat-ui` later.
- Keep this spec at **intent + boundary + invariants**; per-component behavior belongs in the
  components' jsdoc, per-tool detail in [tools/SPEC.md](tools/SPEC.md).
