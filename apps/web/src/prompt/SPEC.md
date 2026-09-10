---
id: submodule-web-prompt
type: submodule-design
status: active
title: prompt — shared command-aware input behavior
parent: module-web
depends-on: [module-contracts]
tags: [v1, ui, prompts]
---

## Responsibility

The reusable, lifecycle-neutral behavior behind command-aware prompt fields: slash parsing and matching,
keyboard/menu interaction, command-catalog normalization, race-safe prompt-template selection, and Pi-compatible
template-slot editing. Chat and pre-session workspace creation supply their own catalogs, template readers,
geometry, and submit actions; this module makes those inputs behave the same once supplied equivalent data.

## Boundary

- **Owns:** the props-driven slash menu and completion controller; pure catalog merge and command insertion;
  frontmatter stripping/template assembly; placeholder parsing, editing, mirroring, highlighting, and finalization;
  the template-pick controller that refuses to overwrite a draft changed after selection.
- **Public surface:** `index.ts` is the only import path and re-exports the command-completion, template-text,
  template-pick, and template-slot APIs.
- **Allowed deps:** `contracts` types, React, and `lib` presentation helpers.
- **Forbidden:** store or transport access; workspace/session/project lookup; deciding which commands exist in a
  lifecycle; sending a prompt; importing `chat` or `panels`.

## Behavior

A slash token is active only at the beginning of the draft and before its first whitespace. Up/Down wrap the
visible matches; Enter/Tab selects; Escape dismisses; IME-owned key events take precedence in the consuming
input. Catalog merge is deterministic and lets the caller's more-specific later source replace a same-named
earlier source.

Template selection is latest-pick-wins and applies only while the draft is byte-identical to its value at pick
time and the caller's project/workspace context is unchanged. The picker exposes pending state so submit
controls stay disabled while it resolves; the draft remains editable, and an edit or context switch invalidates
the delayed application. A selected template replaces the complete draft. Tab and Shift+Tab cycle placeholders, Escape ends the
slot session, edited repeated groups mirror when leaving a slot, and submission removes untouched markers.
Presentation helpers expose the same hint and highlight states while leaving each input's layout to its owner.
