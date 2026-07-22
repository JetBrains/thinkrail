---
id: task-message-gap-40
type: task-spec
status: done
title: Set the between-message gap in the transcript to 40px
parent: submodule-web-chat
---

# Set the between-message gap in the transcript to 40px

## Request

The vertical gap between consecutive messages in the chat transcript = 40px (user↔agent and any two
adjacent messages). Not padding inside a message; nothing else (input/header/tabs/panels) touched. Keep
any existing larger completion-footer gap; if it conflicts, ask.

## Audit

- The transcript is a `Virtuoso` list; each row is wrapped by `ChatView`'s `itemContent`
  `<div className="mx-auto max-w-3xl px-md py-xs">`. That `py-xs` (~4px) is the **only** inter-row
  spacing (the row renderers carry no outer vertical margin), so the current between-message gap is
  ~2×`py-xs` ≈ 8px. → the single seam.
- The round-end `TurnDivider` (the "✓ Done · N tool calls · …" completion footer) has its own `my-sm`
  **inside** the row — left untouched, so the completion area stays slightly larger than 40px (no
  conflict with the note; the current completion gap is not smaller-than-40 being forced up, it's the
  divider's margin *added* to the standard gap).

## Change (minimal, `ChatView.tsx` only)

`itemContent` wrapper `py-xs` → **`py-[20px]`**: each row contributes 20px top + 20px bottom, so the gap
between adjacent transcript messages is exactly **40px**. Explicit px per the request (not a color/token
change); bubble/card internal padding (`px-md py-sm`, markdown internals) is untouched.

## Note / accepted side effect

The transcript is a **flat row list** with no "message-block" DOM grouping, so an agent response that
renders as multiple rows (e.g. an activity group + a markdown answer) gets 40px between those rows too.
"Inside a message" is read as the bubble/card padding (untouched); the between-row gap is the
message-to-message spacing the request targets.
