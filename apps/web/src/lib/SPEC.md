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
  Monaco and xterm reject; `""` when unparseable). Also the shared
  Shiki highlighter, **kept out of the barrel** so the eager `@/lib` import stays shiki-free:
  `highlighter.ts` loads the curated grammars + JS regex engine and renders with `themes`' one generic
  CSS-variable registration. It is imported per-file (`@/lib/highlighter`) from lazy chunks only; theme
  identity/palettes never live in `lib`.
- **Public surface (barrel):** `cn`, `isMarkdownPath`, `stripFrontmatter`, `cssColorToHex`.
- **Allowed deps:** `clsx`, `tailwind-merge`; `shiki`/`@shikijs/*` (the per-file shiki modules only —
  never reachable through the barrel).
- **Forbidden:** every app-internal module — this is a leaf.
