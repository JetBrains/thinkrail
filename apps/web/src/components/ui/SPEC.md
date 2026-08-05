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

- **Owns:** `button` (React-19 ref pass-through; `default`/`destructive`/`outline`/`ghost` variants —
  `destructive` is the red confirm for irreversible actions), `dialog` (with an optional `hideClose` for
  chromeless dialogs), `dropdown-menu`, `context-menu` (sharing private `menu-styles` geometry/token
  classes), `popover` (with an optional `container` portal target — pass the host Dialog node so a popover
  inside a
  Dialog stays wheel-scrollable under its scroll lock), `command` (cmdk combobox body), `textarea`,
  `tooltip`, `resizable`, `toast` (Radix Toast primitives — `ToastProvider`/`Toast`/`ToastViewport`/`Title`/
  `Description`/`Close` + the `error`/`success`/`info` `toastVariants`; a left accent bar carries severity.
  Presentational only — the store owns the queue; `panels/Toaster` composes these against it).
- **Public surface:** each primitive imported directly via `@/components/ui/<name>` (no barrel — preserves
  tree-shaking and the shadcn per-primitive convention).
- **Allowed deps:** Radix (incl. `@radix-ui/react-context-menu`, `@radix-ui/react-popover`,
  `@radix-ui/react-toast`), `cmdk`, `lucide-react`, `lib` (`cn`),
  `class-variance-authority`/`clsx`/`tailwind-merge`.
- **Forbidden:** `store`/`transport`/`panels`/`shell` (primitives are leaf UI); `server`/`shared`/`pi`;
  shadcn's default oklch palette — themed with our token utilities only.

## Get right

- **`context-menu` and `dropdown-menu` are one visual menu system** — same tokenized content surface,
  radius/shadow, item/icon spacing, separators, semantic action colors, focus rows, and viewport collision
  behavior. Context-menu adds only pointer-position right-click + touch long-press anchoring; feature code
  owns which gestures are enabled and what actions mean.
- **`dropdown-menu` content is height-bounded and vertically scrollable** —
  `max-h-[min(60vh, --radix-dropdown-menu-content-available-height)]` + `overflow-y-auto`, with
  **`overflow-x-hidden`** beside it: `overflow-y-auto` alone leaves `overflow-x` at `auto`, so a wide row
  (a long commit subject in the Changes scope menu) earns the menu a horizontal scrollbar when its rows are
  supposed to truncate. It lives on the primitive, not on one caller, because any long menu has the problem:
  rows past the viewport edge are unreachable.
