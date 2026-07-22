---
id: task-completion-line-merge
type: task-spec
status: done
title: "Merge the agent completion into one line: circled Done + divider + metrics"
parent: submodule-web-chat
---

# Merge the agent completion into one line: circled Done + divider + metrics

## Request

When the agent finishes there were two elements — a standalone "✓ Done" line and, below it, a divider
with metrics. Merge into one line: LEFT a circled accent "Done" badge (check + label, existing primary
color); MIDDLE the existing divider rule filling the space; RIGHT the metrics block (tool calls · time ·
files changed), keeping metric styling + the "N files changed" emphasis. Remove the old standalone Done
line. Keep the 24px before / 40px after spacing. Re-layout only — no wire/contract change.

## Audit

The completion was two transcript rows: a `system` turn `text:"✓ Done"` with `endedAt` (rendered by
`SystemTurn`) and the `divider` (`TurnDivider`, from the pure `turnDivider` deriver). `waitForDone`
(e2e fixture) and several `rows.test.ts` sequences pinned the `system` row.

## Change

- `rows.ts`: `deriveRows` no longer emits a row for the turn-end "✓ Done" marker (the `system` turn with
  `endedAt != null`) — it's now the divider's Done badge. Other `system` notices (no `endedAt`) still map
  1:1.
- `turns.tsx` `TurnDivider`: one line — a circled accent Done badge (`turn-done`; `Check` + "Done",
  `rounded-full bg-primary/15 px-sm py-0.5 font-medium text-primary` — existing accent, no new token),
  the `h-px flex-1` rule, then metrics reordered to tool calls · elapsed · files-changed (the clickable
  `turn-divider-files` chip, emphasis unchanged). The old "nothing worth noting → bare hairline" branch
  is gone; the badge + rule always render, metrics only when present.
- `ChatView` `rowTopGap`: the completion is now one row, so the two-row `system`/`divider` special case is
  removed (dropped the `next` param) — `divider` simply takes 24px before it; the next user message keeps
  40px. Spacing unchanged in effect.
- Tests/fixtures: `rows.test.ts` sequences drop the `system` row before dividers (+ index fixups, + a new
  test that a non-`endedAt` system notice still maps 1:1); `waitForDone` now waits on `turn-done`.

## Verification

- lint + typecheck + check:deps green; web unit tests (`rows.test.ts`, 19) + full `bun run test` (166 pass)
  green.
- `@agent` visual check: sent a turn that writes a file; the merged line rendered as
  `✓ Done ———— 1 tool call · 6s · 1 file changed`, and `waitForDone` resolved on the badge. Screenshot
  confirmed the circled accent badge (left), rule (middle), metrics (right).
