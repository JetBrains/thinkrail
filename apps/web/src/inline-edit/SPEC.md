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
  `MarkdownPreview` at a `lineDiff`-computed range — never a floating overlay), the Monaco native review
  (a `lineDiff`-computed decoration on the changed buffer lines + a view zone holding the same woven diff +
  action box, inserted between the lines by `useMonacoInlineEdit` itself), per-surface selection→target
  anchoring, and the fire/refine/keep/revert/stop/open-in-tab orchestration. The inline-edit **state** lives
  in `store` (`inlineEdits`); this module reads it and drives it through store actions + transport.
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
- **Left-bar markers (GitHub-style), parity on both surfaces:** the reviewed region carries a colored left
  bar — green when the change adds/rewrites content, red for a pure deletion (`InlineSuggestion` owns this,
  so the rendered splice and the Monaco zone share it); Monaco additionally gives the changed *buffer* lines
  a green wash + green gutter bar (`.inline-edit-changed-*`). While the agent runs, the selected region gets
  a violet (`--primary`) bar (`.inline-edit-working-gutter` in Monaco; `border-primary` in the rendered
  working block). The Monaco marker classes are literal CSS in `index.css` (decorations apply class names
  outside the React tree).
- Hidden sessions **never** appear in the tab strip unless the user promotes one ("open in tab"/"open as chat").
- Monaco review/working/error render through a Monaco view zone (a real DOM node Monaco lays out between the
  buffer's lines, portaled into via `ReactDOM.createPortal`) plus a decorations collection for the
  changed-lines highlight — both created/torn down by `useMonacoInlineEdit` itself, never a floating card.
  Only the selection pill + instruction popup (firing a new edit) stay floating, same as markdown. Trigger/
  chip/popover have parity on both surfaces.
