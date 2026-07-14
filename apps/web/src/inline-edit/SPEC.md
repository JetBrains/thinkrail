---
id: submodule-web-inline-edit
type: submodule-design
status: active
title: inline-edit — select · instruct · review-in-place
parent: module-web
depends-on: [module-contracts, submodule-web-store]
references: [submodule-web-chat, submodule-web-panels]
tags: [v1, inline-edit, ux]
---

## Responsibility

Inline AI-editing: a user selects text in an open file (rendered markdown or Monaco source), instructs the
agent in a small popup, a **hidden per-edit pi session** makes the change through pi's own edit/write
tools, and the change is reviewed in place (suggestion-style for markdown; a review card for Monaco) with
Keep / Revert / Refine / Open-as-chat.

## Boundary

- **Owns:** the trigger (selection → pill → popup), the working-state chip + read-only preview popover, the
  markdown in-flow woven diff + action box (`InlineSuggestion`, spliced into the rendered document by
  `MarkdownPreview` at a `lineDiff`-computed range — never a floating overlay), the Monaco review card,
  per-surface selection→target anchoring, and the fire/refine/keep/revert/stop/open-in-tab orchestration.
  The inline-edit **state** lives in `store` (`inlineEdits`); this module reads it and drives it through
  store actions + transport.
- **Public surface (barrel `index.ts`):** the controller hooks (`useMarkdownInlineEdit`, `useMonacoInlineEdit`),
  the `InlineEditOrchestrator`, and types. Widgets are internal (rendered by the controllers).
- **Allowed deps:** `store`, `transport`, `chat` (presentational renderers for the preview popover — reused,
  not duplicated), `components/ui`, `lib`, `contracts` (type-only). Reuses `chat/rows` + `chat/turns`.
- **Forbidden:** `server`/`shared`/any `pi` package; sibling panels (panels import THIS module, not the
  reverse); `shell`.

## Notes

- **Edits go through pi**, never a host write — except Revert, which is a direct user action via
  `fs.writeFile` (guarded). The hunk ledger is derived from pi's own tool events (`foldInlineEditEvent` in
  `store`), never recomputed from disk diffs.
- Hidden sessions **never** appear in the tab strip unless the user promotes one ("open in tab"/"open as chat").
- Monaco v0 caveat: review is a changed-lines highlight + review card (no in-text strikethrough — that needs
  view zones; a named follow-up). Trigger/chip/popover have parity on both surfaces.
