---
id: submodule-web-components-ui
type: submodule-design
status: active
title: components/ui — shadcn primitives
parent: module-web
tags: [v1, ui]
---

## Responsibility

The shadcn/ui primitives (Radix), copied in and owned here, themed with our design tokens.

## Boundary

- **Owns:** `button`, `dialog`, `dropdown-menu`, `tooltip`, `resizable`.
- **Public surface:** each primitive imported directly via `@/components/ui/<name>` (no barrel — preserves
  tree-shaking and the shadcn per-primitive convention).
- **Allowed deps:** Radix, `lucide-react`, `lib` (`cn`), `class-variance-authority`/`clsx`/`tailwind-merge`.
- **Forbidden:** `store`/`transport`/`panels`/`shell` (primitives are leaf UI); `server`/`shared`/`pi`;
  shadcn's default oklch palette — themed with our token utilities only.
