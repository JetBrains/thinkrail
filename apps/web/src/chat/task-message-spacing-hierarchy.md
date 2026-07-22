---
id: task-message-spacing-hierarchy
type: task-spec
status: done
title: Group reasoning + steps and apply a 12/24/40px transcript spacing hierarchy
parent: submodule-web-chat
---

# Group reasoning + steps and apply a 12/24/40px transcript spacing hierarchy

## Request

An agent response is a sequence of [reasoning text (`markdown`)] then [a steps row (`activity`, e.g.
"2 steps · read, thinking")], repeated, ending in the round-end status line (`divider`). The uniform
40px between-message gap (`task-message-gap-40`) made the whole response loose. Restructure the vertical
rhythm into a hierarchy that groups a reasoning chunk with the steps row belonging to it:

- **12px** — reasoning ↔ its steps row (inside one group).
- **24px** — group ↔ next group, and group ↔ the round's status line.
- **40px** — agent turn ↔ the next user message.

Purely spacing/grouping — no font/color/token/weight change, no change to content or order.

## Audit

- The transcript is a `Virtuoso` list; `ChatView`'s `itemContent` wrapped every row in
  `<div class="mx-auto max-w-3xl px-md py-[20px]">`, so *every* row boundary was 20+20 = 40px.
- Row kinds (`rows.ts`): `markdown` = a reasoning text block, `activity` = a routine steps run,
  `divider` = the round-end status line. Within a round the order is
  `markdown, activity, markdown, activity, …, divider`, then the next `user`.
- `TurnDivider` (`turns.tsx`) carried its own `my-sm`, which would have added to the item padding.

## Change

- `ChatView`: pure `rowTopGap(prevKind, curKind, nextKind)` returns the *lower* row's top-padding class;
  `itemContent` applies it (bottom padding 0, so a gap = exactly one value) with 20px top breathing on
  the first row and 20px bottom on the last. Mapping: `markdown→activity` = 12px; `activity→markdown` =
  24px; a `system` "✓ Done" marker whose next row is a `divider` = 24px (start of the completion status);
  a `divider` = 12px when it follows that marker (one block), else 24px; everything else (turn
  boundaries, other rows) = 40px.
- `turns.tsx`: dropped `TurnDivider`'s `my-sm` (both variants) so item-level spacing is exact.
- `Markdown.tsx`: trimmed the chat prose skin's **outer** margins
  (`[&>*:first-child]:mt-0 [&>*:last-child]:mb-0`) — the `[&_p]:my-sm` paragraph margin was leaking ~8px
  out of the reasoning block on both sides, inflating every markdown-adjacent gap (reasoning→steps
  rendered 20px, not 12px). Inter-paragraph spacing inside a block is unchanged.

## Verification (real transcript, not just units)

Ran an `@agent` diagnostic driving a real pi agent through a multi-round turn, dumping the rendered row
order + each wrapper's *measured* pixel gap. The per-round order is
`markdown(reasoning) → activity(steps) → markdown → … → system("✓ Done") → divider`, so the
`markdown→activity` rule is the correct key. Final measured gaps matched the intent exactly: turn
boundary 40px, reasoning→steps **12px**, group→group 24px, before "✓ Done" 24px, divider under it 12px
(before the outer-margin trim these read 48 / 20 / 32 / 40). Screenshot confirmed the grouping. lint +
typecheck + check:deps green.
