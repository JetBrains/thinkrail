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

- React 19 refs pass through controls; dialog/popover portals preserve accessible focus and scroll
  behavior. Popover accepts a host Dialog container for scroll-lock compatibility.
- Icon-only controls use `IconTooltip` with `aria-label`, not native `title`. `wrapTrigger` supplies the
  interactive span for a disabled control or another Radix trigger, isolating their `data-state` values;
  callers do not hand-roll that wrapper. App and extension call-site tests enforce this convention.
- Context and dropdown menus share private menu geometry and token classes. Dropdowns are vertically
  bounded and scrollable with horizontal overflow hidden so long rows truncate rather than scroll.
- Toast severity is a presentational accent; queue ownership and notification lifetimes stay in the app.

Code highlighting is deliberately absent: `CodeBlock` and shiki depend on the app's theme registration
and remain app-local until a second extension requires that seam.
