---
id: module-ui
type: module-design
status: draft
title: Shared host UI primitives
parent: architecture
depends-on: [module-contracts]
references: [web-color, web-spacing, web-typography]
---

## Responsibility

The owned shadcn/Radix primitives shared by the app and extension web halves. Presentational only:
feature state, theme selection, and token generation stay with the app.

## Boundary

Primitives expose per-file `@thinkrail/ui/<primitive>` subpaths, not a root component barrel; this keeps
lazy chunks independent and preserves the shadcn convention. `./utils` exposes `cn`; `./theme` exposes
only `onThemeSwap`, a DOM MutationObserver subscription to the completed `data-theme` signal, with
explicit cleanup. It knows nothing about the theme catalog or preferences.

Workspace imports may reach `contracts` only. External dependencies are React, Radix, cmdk,
react-resizable-panels, Remix Icon, class-variance-authority, clsx and tailwind-merge. Host internals,
pi, app stores, transport and theme runtime are forbidden. Tokens remain global CSS variables generated
under `apps/web/src/styles`; utilities follow [[web-color]], [[web-spacing]] and [[web-typography]].
The app's Tailwind sources and adoption guards include this package and extension web halves.

## Primitive invariants

The per-file surface is `button`, `switch`, `dialog`, `dropdown-menu`, `context-menu`, `menu-styles`,
`popover`, `command` (cmdk combobox body), `textarea`, `tooltip`, `resizable`, and `toast`, alongside
`utils` and `theme`. `menu-styles` is shared by the menu primitives and custom app menu rows.

- Button variants are `default`/`destructive`/`outline`/`ghost`; destructive confirms irreversible
  actions. Switch exposes native disabled behavior and `role="switch"`/`aria-checked`, not visible On/Off
  text. Dialog accepts `hideClose` for chromeless surfaces. `DialogPanel` renders Radix content in place
  without a portal or overlay for caller-positioned, non-modal dialogs; title/role semantics, Escape
  dismissal, and focus return remain Radix-owned while surrounding UI stays interactive.
- React 19 refs pass through controls; dialog/popover portals preserve accessible focus and scroll
  behavior. Popover accepts a host Dialog container for scroll-lock compatibility.
- Icon-only controls use `IconTooltip` with `aria-label`, not native `title`; one root `TooltipProvider`
  sets the delay. Native `title` remains only for non-control truncation fallbacks or surfaces outside
  the provider (the app's review widgets). `wrapTrigger` supplies the interactive flex span for a disabled
  control or another Radix trigger, isolating their `data-state` values; callers do not hand-roll that
  wrapper. App, SDK, and extension web call-site tests enforce this convention.
- Context and dropdown menus share menu geometry and token classes: content surface, radius/shadow,
  item/icon spacing, separators, semantic action colors, focus rows, and viewport collision behavior.
  Context menus add pointer-position right-click/touch long-press anchoring; features own enabled gestures
  and actions. Dropdowns are vertically bounded by the smaller of 60vh and Radix's available height,
  scrollable with horizontal overflow hidden so long rows truncate rather than scroll.
- Toast exposes `ToastProvider`/`Toast`/`ToastViewport`/`ToastTitle`/`ToastDescription`/`ToastAction`/
  `ToastClose` and `toastVariants` (`error`/`success`/`info`). Severity is a presentational left accent;
  queue ownership and notification lifetimes stay in the app (`panels/Toaster` composes the primitives).
- Primitives use only the host's token utilities, never shadcn's default oklch palette.

Code highlighting is deliberately absent: `CodeBlock` and shiki depend on the app's theme registration
and remain app-local until a second extension requires that seam.
