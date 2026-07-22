---
id: task-copy-user-message
type: task-spec
status: done
title: Add a hover copy button to user messages
parent: submodule-web-chat
---

# Add a hover copy button to user messages

## Request

A copy button on each USER message: copies the message text; placed below the bubble, right-aligned to
its edge, 6px gap; hidden by default, revealed on hover over the message; reuse the existing copy
affordance (brief "copied" confirmation). User messages only; don't touch agent messages, input, header,
tabs, panels, or the message spacing hierarchy.

## Change (`turns.tsx`)

- New `CopyMessageButton` — the shared copy affordance reused verbatim from `JetBrainsAiCard`'s
  `CopyableCommand`: `navigator.clipboard.writeText`, then `Copy` icon flips to a green `Check` for
  ~1.5s. Existing icon + button utilities; no new token.
- `UserTurn` wraps the bubble in a `group relative max-w-[85%]` (moved `max-w-[85%]` off the bubble). The
  button is `absolute top-full right-0 mt-[6px]` (6px below, right-aligned) and `opacity-0
  group-hover:opacity-100` (also `focus-visible:opacity-100` for keyboard). Absolute so revealing it never
  reflows the transcript — it occupies the existing gap below the message; the between-message spacing is
  unchanged. `group` is the bubble wrapper, so only hovering the message snippet reveals it.

## Verification

- lint + typecheck + check:deps green.
- `e2e/copy-user-message.spec.ts` (no-agent): send a message (appended client-side), hover, click copy →
  the clipboard holds the text and the button shows its green-check confirmation.
- Screenshot confirmed the button below the bubble, right-aligned, on hover.
