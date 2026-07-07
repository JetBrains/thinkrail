---
id: task-chat-noise-reduction
type: task-spec
status: done
title: Chat UI progressive disclosure — fold routine activity, surface what matters
parent: submodule-web-chat
tags: [v1, chat, ux]
---

## Request

Improve the chat UI's signal-to-noise ratio: fold routine activity (tool calls, thinking) behind
collapsible sections, draw attention to what matters (answers, errors, interactive cards,
visualizations — auto-unfold `visualize`), and generally minimize visual noise in long agent rounds.

## Decisions (all confirmed with user, rounds 1–2)

1. **Fold shape: contiguous runs.** Consecutive routine blocks (thinking + routine tool calls),
   *across assistant-message boundaries within a round*, collapse into one "N steps" fold. The agent's
   interim narration text stays visible and splits folds.
2. **Attention = auto-expand + visual accent.** Primary items escape the fold and render expanded;
   items awaiting the user (a pending question) get a subtle token-based accent.
3. **Streaming: live ticker, collapse when done.** While a run is active its fold is a slim live line
   (status spinner + the current step's registered summary — richer than the footer loader's phase
   word); finished steps accumulate behind it. It collapses when answer text starts / the run ends.
   A manual toggle always wins.
4. **Defaults:** `visualize` is primary and auto-opens; `web_search`/`web_fetch` are routine;
   `thinking` is routine (today's watch-the-thinking-stream default is replaced by the slim ticker —
   expanding the live fold still shows the streaming thinking text).
5. **Errors inside folds get no special treatment** (deliberate): a failed step looks like any other
   step until expanded (status icons on step rows still show ✕). The safety nets stay: `ErrorTurn` for
   terminal failures is never folded, and *primary* card tools keep today's error-auto-expand.
6. **Prominence is settings-ready but not user-configurable yet:** registry-declared defaults resolved
   through one seam (a resolver), so a per-user override map can plug in later. Settings UI = follow-up.
7. **No tool categories.** Fold headers summarize by tool name ("8 steps · bash ×2, read ×4, …").

## Design

### 1. Registry: prominence metadata (extends the extension point)

`registerToolRenderer` registration grows presentation metadata:
- `prominence?: "routine" | "primary"` — routine folds into activity groups; primary escapes the fold.
  Default — and for unregistered tools — `routine`. `"bare"` chrome implies primary.
- `defaultExpanded?: boolean` — primary `"card"` tools render expanded once complete.

Read through a single resolver (`resolveProminence(toolName)`) — the future settings seam. Defaults:
`visualize` → primary + `defaultExpanded`; `ask_user_question` → bare (primary by construction);
everything else (bash/read/write/edit/web_*/spec_*/unknown) → routine.

### 2. Row derivation (pure, testable)

Grouping spans assistant-message boundaries, so Virtuoso can no longer render one item per *turn*.
A pure `deriveRows(turns, toolResults, isStreaming)` (new `rows.ts`) flattens turns into render rows:

- `user` / `system` / `error` / `retry` — map 1:1 to the existing turn renderers.
- `markdown` — a non-empty assistant `text` block (`Markdown`).
- `activity` — an ordered run of routine steps (`thinking` | routine `toolCall`), merged across
  consecutive assistant messages in the same round; broken by non-empty text, primary tools, and
  non-assistant turns. Steps carry `dead` (from the owning message's `stopReason`) as today.
- `tool` — a primary tool call (`ToolCard` or bare renderer), as today.
- `divider` — the round-end `TurnDivider` (the `turnDivider` deriver moves behind `deriveRows`).

`AssistantTurn`'s block walk dissolves into this derivation; `ChatTurnView` becomes a row dispatcher.
Row/step ids are stable across streaming snapshots (first step's `toolCallId`, or message-anchored
index for thinking — pi appends, never reorders), so expansion state survives re-derivation and
virtualization (module-level cache keyed by row id, the `AskUserQuestionCard` pattern). Memoized in
`ChatView`; `useChatScroll` unchanged.

### 3. The activity fold (`ActivityGroup`)

- **Collapsed:** chevron + "N steps · bash ×2, read ×4" (names capped, "+k more" overflow).
- **Expanded:** slim step rows — status icon + name + registered summary, *no per-step card borders*;
  clicking a step reveals that step's full renderer body (the registry renderer, as `ToolCard`'s body
  today). Thinking steps expand to the thinking text.
- **Live:** while streaming, the trailing run's header is the live ticker (decision 3); expanded-live
  shows steps appearing + streaming thinking. Single-loader invariant holds — the footer
  `StreamIndicator` stays the only typing-dots loader; the fold header carries a status spinner like
  today's running `ToolCard` header.
- **Single-step runs render the step row directly** (no group header wrapping one line).

### 4. Attention accents (token utilities only)

- `ask_user_question` awaiting an answer: subtle primary-tinted accent ring on the card.
- Primary card tools keep error-auto-expand; `visualize` renders expanded on completion
  (`defaultExpanded`) — while args stream it stays a slim running row.

### Touched / affected

- `apps/web/src/chat/`: `toolRegistry.tsx` (+prominence), new `rows.ts` + `ActivityGroup.tsx`,
  `turns.tsx` (dissolve `AssistantTurn`/`ThinkingBlock` into rows), `ChatView.tsx` (rows into
  Virtuoso), `tools/register.ts` + `tools/visualize/register.ts` (declare prominence),
  `AskUserQuestionCard` (accent).
- Tests: `rows.test.ts` (grouping edge cases: cross-message merge, text splits, dead calls, live
  trailing run); existing `turns.test.ts`, `toolRegistry.test.ts` updated.
- e2e: `tool-cards.live.spec.ts`, `chat-scroll`, `spec-tools`, `turn-divider`, `visualize`,
  `web-tools` specs assert `tool-card`/`data-expanded` hooks — updated to the new
  `activity-group`/`activity-step` testids where routine tools now live. Verified via `bun run e2e`
  (+ `e2e:agent` for the live specs).

## Out of scope

- Server/capability side — presentation-only (`apps/web/src/chat`).
- Prominence settings UI (follow-up; the resolver seam is the hook).
- Tool categories (declined).
