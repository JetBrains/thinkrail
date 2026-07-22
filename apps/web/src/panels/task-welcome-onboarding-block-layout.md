---
id: task-welcome-onboarding-block-layout
type: task-spec
status: done
title: Shared left-aligned block layout for welcome + onboarding
parent: submodule-web-panels
---

# Shared left-aligned block layout for welcome + onboarding

## Request

Redesign both screens to a shared **left-aligned block** (drop the centered-on-both-axes look).
Layout/alignment only — typography, copy, cards, the worktree "?", and triggers are unchanged.

## Shared principle

A single block constrained to ~60% of its area's width (wider on mobile), centered by **position alone**
— no border/card/background. Text (title + description) flush-**left** at the top; the primary action at
the block's **bottom-right** (shared bounds), so the eye reads text (top-left) → action (bottom-right). A
tidy composition, not spread with big vertical gaps.

## Change (layout classes only)

- **`WelcomePanel`:** the outer becomes `flex flex-col justify-center` (dropped `items-center`/
  `text-center`); a new inner block `mx-auto w-full max-w-[90%] md:max-w-[60%] flex flex-col` holds the
  left-aligned eyebrow / `ThinkRail` hero / pitch (dropped the pitch's fixed `max-w-[440px]`), and the
  cards row flipped `justify-center` → `justify-end` (bottom-right). The dialogs stay outside the block.
- **`Onboarding`:** `DialogContent` gains `flex`; the column is now `m-auto w-full max-w-[90%]
  md:max-w-[60%] flex flex-col gap-lg` (dropped the full-height `min-h-full` + `flex-1 justify-center`
  spreading). Step indicator left-aligned at the top (`items-start`); title/description left (dropped
  `text-center`); the step-0 root field stays left; the footer (Back left / Continue|Get started right)
  now sits at the block's bottom-right within the 60% bounds, not the far viewport corner.

## Verification

- lint + typecheck + check:deps green; `onboarding` + `welcome` specs green (testids/behavior unchanged).
- Screenshots confirmed both screens: left-aligned block, action bottom-right, ~60% centered, no panel —
  and the shared composition across the two.
