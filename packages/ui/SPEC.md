---
id: module-ui
type: module-design
status: draft
title: Shared host UI primitives
parent: architecture
depends-on: [module-contracts, module-locales]
references: [web-color, web-spacing, web-typography]
---

## Responsibility

The owned shadcn/Radix primitives shared by the app and extension web halves. Presentational only:
feature state, theme selection, and token generation stay with the app.

## Boundary

Primitives expose per-file `@thinkrail/ui/<primitive>` subpaths, not a root component barrel; this keeps
lazy chunks independent and preserves the shadcn convention. `./utils` exposes `cn`; `./keyboard` exposes
`isImeComposing` and `yieldEscapeToIme`; `./theme` exposes
only `onThemeSwap`, a DOM MutationObserver subscription to the completed `data-theme` signal, with
explicit cleanup. It knows nothing about the theme catalog or preferences.

Workspace imports may reach `contracts` and `@thinkrail/locales/react` (the shared i18next instance, for
primitive-owned strings such as the dialog's screen-reader Close and the toast's Dismiss label) only. External dependencies are React, Radix, cmdk,
react-resizable-panels, Remix Icon, class-variance-authority, clsx and tailwind-merge. Host internals,
pi, app stores, transport and theme runtime are forbidden. Tokens remain global CSS variables generated
under `apps/web/src/styles`; utilities follow [[web-color]], [[web-spacing]] and [[web-typography]].
The app's Tailwind sources and adoption guards include this package and extension web halves.

## Primitive invariants

The per-file surface is `button`, `switch`, `dialog`, `dropdown-menu`, `context-menu`, `menu-styles`,
`popover`, `command` (cmdk combobox body), `textarea`, `tooltip`, `resizable`, `toast`, `toggle-segment`
(the slim header toggle: active segment on `control-bg-selected` + `text-default`, `data-active` /
`aria-pressed`), and `skeleton` (`SkeletonRows` / `LoadingRegion`, the one loading placeholder; its usage rules
live in the web components spec), alongside `utils`, `keyboard` and `theme`. `menu-styles` is shared by the menu
primitives and custom app menu rows. `toggle-segment` and `skeleton` moved here from the app when the
resource renderers became a package, because both the app and [[module-resource-renderers]] use them.

- Button variants are `default`/`destructive`/`outline`/`ghost`/`soft`; destructive confirms irreversible
  actions, and `soft` (primary-tinted surface + primary text) marks a prominent secondary action such as
  provider Sign in / New template. Switch exposes native disabled behavior and `role="switch"`/`aria-checked`, not visible On/Off
  text. Every modal dialog's overlay carries `data-modal-layer`, and `useModalLayerOpen()` reports whether one is open: it lets callers tell "covered by a modal" from their own visibility without a dialog registry, independent of how `aria-hidden` treats live regions. Dialog accepts `hideClose` for chromeless surfaces. `DialogPanel` renders Radix content in place
  without a portal or overlay for caller-positioned, non-modal dialogs; title/role semantics, Escape
  dismissal, and focus return remain Radix-owned while surrounding UI stays interactive.
- **An active IME owns the key** ([[module-web]]'s text-field rule). `isImeComposing` is `isComposing`
  or the legacy `keyCode` 229 sentinel, the same test cmdk applies. The sentinel is needed because
  `compositionend` may come before the final keydown, leaving `isComposing` false while the IME still
  owns that event. `DialogContent`, `DialogPanel` and `PopoverContent` wrap the caller's
  `onEscapeKeyDown` in `yieldEscapeToIme`. A composing Escape is `preventDefault`ed, so Radix's
  document-level Escape listener keeps the layer open, and the caller's handler never sees it. Menus hold
  no text fields and stay unwrapped. `keyboard.test.ts` scans the app, ui, `resource-renderers` and
  extension web sources: a file with both a key handler and a text field must use the guard. The scan is
  file-level, and each allow-list entry carries its reason.
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
  `ToastClose` and `toastVariants` (`error`/`success`/`warning`/`info`). Severity is a uniform semantic
  border (`border-feedback-*-muted`) on a neutral `bg-container-elevated-bg` background. `ToastAction` is
  unstyled: the caller supplies the control through `asChild`. Queue ownership, icons, and notification
  lifetimes stay in the app (`panels/Toaster` composes the primitives).
- Resizable handles paint a 1 px line at their leading edge; the pointer hit area extends only into the
  following panel (fine-pointer margin 1 px), so the preceding panel's trailing-edge scrollbar stays
  usable. There is no grip variant.
- Primitives use only the host's token utilities, never shadcn's default oklch palette.

Code highlighting is deliberately absent: `CodeBlock` and shiki depend on the app's theme registration
and remain app-local until a second extension requires that seam.
