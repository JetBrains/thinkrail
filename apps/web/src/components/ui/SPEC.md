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

- **Owns:** `button` (`default`/`destructive`/`outline`/`ghost` variants — `destructive` is the red
  confirm for irreversible actions), `dialog` (with an optional `hideClose` for chromeless dialogs), `dropdown-menu`,
  `popover` (with an optional `container` portal target — pass the host Dialog node so a popover inside a
  Dialog stays wheel-scrollable under its scroll lock), `command` (cmdk combobox body), `textarea`,
  `tooltip`, `resizable`, `toast` (Radix Toast primitives — `ToastProvider`/`Toast`/`ToastViewport`/`Title`/
  `Description`/`Close` + the `error`/`success`/`info` `toastVariants`; a left accent bar carries severity.
  Presentational only — the store owns the queue; `panels/Toaster` composes these against it).
- **Public surface:** each primitive imported directly via `@/components/ui/<name>` (no barrel — preserves
  tree-shaking and the shadcn per-primitive convention).
- **Allowed deps:** Radix (incl. `@radix-ui/react-popover`, `@radix-ui/react-toast`), `cmdk`, `lucide-react`, `lib` (`cn`),
  `class-variance-authority`/`clsx`/`tailwind-merge`.
- **Forbidden:** `store`/`transport`/`panels`/`shell` (primitives are leaf UI); `server`/`shared`/`pi`;
  shadcn's default oklch palette — themed with our token utilities only.
