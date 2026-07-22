---
id: task-agent-message-width
type: task-spec
status: done
title: Constrain the agent message frame to 85% width (slack on the right)
parent: submodule-web-chat
---

# Constrain the agent message frame to 85% width (slack on the right)

## Request

Assistant (agent) message content occupies at most **85%** of the chat width, left-aligned, with the
~15% slack on the **right** — applied as a responsive max-width on the agent message frame (text,
thinking, step/activity rows). User messages, composer, header, tabs, panels unchanged. No new
styles/tokens/colors/spacing/alignment — purely a max-width constraint.

## Audit

- Rows render inside `ChatView`'s centered content column: `mx-auto max-w-3xl px-md py-xs`.
- The **user** bubble is already `max-w-[85%]` inside `flex justify-end` (85% of the column,
  right-aligned) — so the exact mirror for the agent is `max-w-[85%]` **left-aligned** (block default →
  slack on the right). `max-w-[85%]` is already used in the codebase (the user bubble), so this reuses
  an existing utility, no new token/style.
- Assistant content spans three row kinds (`turns.tsx` `ChatTurnView`): `markdown` (text), `tool`
  (primary tool cards), `activity` (routine steps + thinking). `user`/`system`/`error`/`retry`/
  `divider` are out of scope.

## Change (minimal, `turns.tsx` only)

Apply `max-w-[85%]` to the three assistant row frames — add it to the `markdown` row's existing div,
and wrap the `tool` and `activity` rows in a `max-w-[85%]` block. Block-level + left-aligned by
default, so the content stays left and the slack falls on the right; it scales with the column (hence
the window). Nothing else changes.

## Constraints honored

Assistant messages only (user/composer/header/tabs/panels untouched); alignment stays left; no new
styles/tokens; frontend-only, no wire/contract change.
