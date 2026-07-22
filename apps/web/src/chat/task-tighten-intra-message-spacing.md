---
id: task-tighten-intra-message-spacing
type: task-spec
status: done
title: "Halve the intra-message gaps: 6px inside a group, 12px between groups"
parent: submodule-web-chat
---

# Halve the intra-message gaps: 6px inside a group, 12px between groups

## Request

Tighten the agent-response rhythm (`task-message-spacing-hierarchy`): inside a group (reasoning ↔ its
steps row) 12px → **6px**; between groups and before the completion status line 24px → **12px**. Leave
the 40px agent-turn ↔ next-user-message gap unchanged. Purely the two intra-message gap values.

## Change

`ChatView.rowTopGap`: `markdown→activity` `pt-[12px]` → `pt-[6px]`; `activity→markdown` and `→divider`
`pt-[24px]` → `pt-[12px]`. The `pt-[40px]` turn boundary and `pt-[20px]` first-row breathing are
untouched. New hierarchy: 6px (reasoning ↔ steps) < 12px (group ↔ group, group ↔ status) < 40px (turn).

## Verification

- lint + typecheck + check:deps green.
- Values only; the row model, order, and 40px boundary are unchanged (covered by the existing
  `rows.test.ts` + the `@agent` transcript check from `task-message-spacing-hierarchy`).
