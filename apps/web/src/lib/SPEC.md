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
  block so the rendered view doesn't render spec metadata as a heading).
- **Public surface (barrel):** `cn`, `isMarkdownPath`, `stripFrontmatter`.
- **Allowed deps:** `clsx`, `tailwind-merge`.
- **Forbidden:** every app-internal module — this is a leaf.
