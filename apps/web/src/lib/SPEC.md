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

- **Owns:** `utils.ts` → `cn()` (merge clsx output through tailwind-merge).
- **Public surface (barrel):** `cn`.
- **Allowed deps:** `clsx`, `tailwind-merge`.
- **Forbidden:** every app-internal module — this is a leaf.
