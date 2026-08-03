---
id: submodule-web-lib
type: submodule-design
status: active
title: lib — UI helpers
parent: module-web
tags: [v1]
---

## Responsibility

Tiny UI helpers shared across components.

## Boundary

- **Owns:** `utils.ts` → `cn()` (merge clsx output through tailwind-merge) + `isMarkdownPath()` (the
  `.md`/`.markdown` gate for the rendered-preview view) + `stripFrontmatter()` (drop a leading YAML `---`
  block so the rendered view doesn't render spec metadata as a heading) + `cssColorToHex()` (canonicalize
  a CSS color to hex — minified CSS serves `#fff`/`gray`-style equivalents, which strict consumers like
  Monaco and xterm reject; `""` when unparseable). Plus the primitives that more than one module needs and
  none should re-state: **`normalizePath()`** / **`isAbsolutePath()`** (a path from a pi tool call or the
  host may use either separator and may be relative or absolute — every path predicate in the app starts
  from these, so `chat`'s display helpers and `store`'s worktree matcher share one definition) and
  **`shallowEqualArrays()`** (element-wise `Object.is` — the "did this really change?" test behind the
  store's snapshot-identity guard and `ErrorBoundary`'s reset keys),
  **`relativeTime()`** (`just now` / `5m ago` / `2d ago` — shared by chat history, the tab strip's closed
  chats, and the Changes scope menu's commit rows; it lives here because `chat/` may not import from
  `panels/`, which is what let three private twins of it accumulate) and **`copyText()`**
  (clipboard write reporting whether it landed — one place for the *degradation*: an insecure context
  (plain-http remote access) or a denied permission has no clipboard, and every caller's answer is the same
  — do nothing loud, the text stays visible/selectable). Also the shared
  Shiki highlighter, **kept out of the barrel** so the eager `@/lib` import stays shiki-free:
  `highlighter.ts` loads the curated grammars + JS regex engine and renders with `themes`' one generic
  CSS-variable registration. It is imported per-file (`@/lib/highlighter`) from lazy chunks only; theme
  identity/palettes never live in `lib`.
- **Public surface (barrel):** `cn`, `isMarkdownPath`, `stripFrontmatter`, `cssColorToHex`,
  `normalizePath`, `isAbsolutePath`, `projectRelativePath`, `shallowEqualArrays`, `relativeTime`, `copyText`.
- **Allowed deps:** `clsx`, `tailwind-merge`; `shiki`/`@shikijs/*` (the per-file shiki modules only —
  never reachable through the barrel).
- **Forbidden:** every app-internal module — this is a leaf.
