---
id: task-collapse-long-messages
type: task-spec
status: done
title: Collapse long chat-history messages behind an Expand control
parent: submodule-web-chat
---

# Collapse long chat-history messages behind an Expand control

## Request

In the transcript, the **last** message always renders full; every earlier message (user prompt AND
agent response) whose text is **> 300 chars** collapses to the first ~300 chars + an **"Expand"**
control (expanded shows **"Collapse"**); ≤ 300 chars renders full with no control. Expanded/collapsed
is per-message client-side view state, remembered while the thread is open, never sent to the server.
Reuse existing text styles + the existing expand/collapse affordance; no new styles/tokens/buttons; no
layout change beyond truncating + the control. Frontend-only, minimal, own commit, English UI text.

## Audit / reuse

- Text-bearing renderers (`chat/turns.tsx`): **`UserTurn`** (a `user` row's bubble) and the **`markdown`**
  row (assistant text via `<Markdown>`). Those are the "messages" to collapse. Other rows (activity,
  tool, divider, system/error/retry) are out of scope.
- **`useFold(id)`** (`foldState.ts`) is the exact view-state primitive: a module-scoped per-id cache
  that survives virtualization + re-derivation **while the thread is open**, never persisted/sent to the
  server. Row ids are stable (`rows.ts`): `user` = `turn.id`; `markdown` = `${turn.id}:text:${b}`.
- **Existing affordance:** `tools/Collapsible.tsx`'s toggle button — `self-start text-primary text-xs
  hover:underline`. Reuse that exact styling; only the label differs ("Expand"/"Collapse"). Its
  line/height clipping doesn't fit a char-count rule, so just the button style is reused.

## Design

- Pure helper **`messageCollapse.ts`**: `MESSAGE_COLLAPSE_LIMIT = 300`; `shouldCollapseMessage(text,
  isLast) = !isLast && text.length > 300`. Unit-tested (the "mocked data": long / short / boundary /
  last-message cases).
- **`CollapsibleMessage`** (in `turns.tsx`, presentational): props `{ id, text, isLast, children:
  (shown) => ReactNode }`. When not collapsible → renders `children(text)` unwrapped (short messages +
  the last message are untouched). When collapsible → a `flex flex-col gap-xs` wrapper (mirrors
  `Collapsible`) with `children(expanded ? text : text.slice(0,300) + "…")` + a reused-style toggle
  button labelled **Expand/Collapse** (`data-testid="message-collapse-toggle"`), expanded state via
  `useFold(id)` (default collapsed).
- Wire-in: `UserTurn` wraps its bubble text; the `markdown` case wraps `<Markdown>`. `ChatTurnView`
  gains an `isLastMessage` prop; **`ChatView`** computes `lastMessageRowId` (the last `user`/`markdown`
  row id) and passes `isLastMessage = row.id === lastMessageRowId`. So the newest text block is always
  full; earlier long ones collapse (auto-collapsing once they stop being last, unless toggled).

## Scope / constraints

Agent-response + user messages only; no changes to input/header/tabs/panels/running-steps. No
wire/contract changes — pure client re-render of already-present text. Existing tokens/text styles
untouched. (Edge: an assistant message with multiple text blocks marks only its last block as "last" —
acceptable; single trailing text block is the norm.)
