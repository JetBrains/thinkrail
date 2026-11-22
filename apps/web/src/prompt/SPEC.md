---
id: submodule-web-prompt
type: submodule-design
status: active
title: prompt — shared command-aware input behavior
parent: module-web
depends-on: [module-contracts]
tags: [ui, prompts]
---

## Responsibility

The reusable, lifecycle-neutral behavior behind command-aware prompt fields: slash parsing and matching,
keyboard/menu interaction, command-catalog normalization, race-safe prompt-template selection, and Pi-compatible
template-slot editing. Chat and pre-session workspace creation supply their own catalogs, template readers,
geometry, and submit actions; this module makes those inputs behave the same once supplied equivalent data.

## Boundary

- **Owns:** the props-driven slash menu and completion controller; the argument-completion step
  (`ArgumentCompletion.tsx`) — parsing, keys, insertion, the menu frame and the command/argument tint; pure catalog merge and command insertion;
  frontmatter stripping/template assembly; placeholder parsing, editing, mirroring, highlighting, and finalization;
  the template-pick controller that refuses to overwrite a draft changed after selection.
- **Public surface:** `index.ts` is the only import path and re-exports the command-completion, argument-completion,
  template-text, template-pick, template-slot, and caret/selection-restoration (`usePendingSelection`) APIs.
- **Allowed deps:** `contracts` types, React, `@thinkrail/locales` (UI strings), `@thinkrail/ui/utils` (`cn`), and `@thinkrail/ui/button` (`TemplateSlotHint` is a shared `Button`).
- **Forbidden:** store or transport access; workspace/session/project lookup; deciding which commands exist in a
  lifecycle; sending a prompt; importing `chat` or `panels`.

## Behavior

A slash token is active only at the beginning of the draft and before its first whitespace. Up/Down wrap the
visible matches; Enter/Tab selects; Escape dismisses; IME-owned key events take precedence in the consuming
input. Catalog merge is deterministic and lets the caller's more-specific later source replace a same-named
earlier source.

**Argument completion** takes over once a command is completed: when the whole draft is one line
`/<command> <argument>` and the command declares `argumentCompletion` (from the host's catalog), the
text after the command is the caller's query. The module decides the keys — ↑/↓ wrap the caller's
candidates, Enter picks (Shift+Enter and an empty list let Enter through, so the draft can still be sent
as typed), Tab / Shift+Tab hand focus to the caller's filter row, Escape dismisses until the query
changes — and the caller decides what the candidates are, when an argument is complete (the menu then
closes for whatever follows it, such as a focus note), and renders rows, header and footer inside
`ArgumentCompletionMenu`. A pick replaces the argument and adds one space. `slashArgumentTint` splits
the draft into command / argument / plain spans for a prompt's highlight layer. The slash menu and the
argument step never overlap: one needs a token without whitespace, the other a space after it.

Template selection is latest-pick-wins and applies only while the draft is byte-identical to its value at pick
time and the caller's project/workspace context is unchanged. The picker exposes pending state so submit
controls stay disabled while it resolves; the draft remains editable, and an edit or context switch invalidates
the delayed application. A selected template replaces the complete draft. Tab and Shift+Tab cycle placeholders, Escape ends the
slot session, edited repeated groups mirror when leaving a slot, and submission removes untouched markers.
Presentation helpers expose the same hint and highlight states while leaving each input's layout to its owner.
`usePendingSelection` applies a requested caret/selection in a layout effect, in the same commit as the value
change and never a deferred frame: a frame landing between a follow-up select-all and its insert (a paste,
Playwright's `fill`) would collapse the selection, so the insert appends and doubles the draft.
