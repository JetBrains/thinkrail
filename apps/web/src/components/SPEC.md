---
id: submodule-web-components
type: submodule-design
status: active
title: components — ErrorBoundary primitive (+ ui/)
parent: module-web
tags: [v1, ui, resilience]
---

## Responsibility

The app's dependency-light shared React primitives: the error boundary that keeps one failed region from
unmounting the root, project-custom icons, and the quiet-scroll frame used by shell and feature panels.
Also houses the `ui/` sub-module (shadcn primitives), which has its own spec.

## Boundary

- **Owns:** `ErrorBoundary.tsx` — a class boundary (`getDerivedStateFromError`) that renders a themed,
  self-contained fallback instead of propagating a throw to the root. It:
  - resets a caught error when any `resetKeys` value changes (wire to the subtree's identity —
    workspace/tab id — so navigating away auto-recovers);
  - classifies failed dynamic `import()`s via the pure, unit-tested **`isChunkLoadError`** (stale Vite
    chunk / 504 / Safari "module script failed") and steers those to a page **reload** (re-fetches the
    chunk) rather than an in-place retry;
  - logs the crash to the console (`componentDidCatch`) — the UI already degrades gracefully.
- **`CustomIcon.tsx`** — renders an SVG from `public/custom-icons/` as a themeable `currentColor` glyph
  via a CSS `mask-image` span (`.custom-icon*` classes in `index.css`), so a custom glyph sizes with
  `size-*` and colours with `text-*` exactly like a Remix icon. Names are a typed union
  (`CustomIconName`); today: `file-diff-line`/`file-diff-fill` (the Changes tool glyph).
- **`QuietScrollArea.tsx`** — the store-free overflow observer and two presentation surfaces:
  `QuietScrollArea` owns an ordinary native scroll viewport, while `QuietScrollFrame` observes a
  third-party descendant viewport without taking over its content or input. Both reserve the native 10px
  gutter, make the thumb visually transparent at rest in normal themes, reveal a 5px optical thumb on
  hover/focus-within/drag/active scrolling, and paint pointer-transparent 16px curtains only on clipped
  directions. The observer follows scroll, viewport/content resize, and descendant replacement. Bundled
  high-contrast themes retain a resting hairline; OS forced-colours mode keeps a visible system-colour
  thumb and removes the cosmetic curtains; reduced motion removes the opacity transition only. Surface
  colour is an explicit semantic prop (`sidebar` or `terminal`), never inferred from arrangement.
- **Public surface:** `ErrorBoundary`, `isChunkLoadError` — imported directly via
  `@/components/ErrorBoundary` (no barrel); `CustomIcon`, `CustomIconName` via `@/components/CustomIcon`;
  `QuietScrollArea`, `QuietScrollFrame` via `@/components/QuietScrollArea`. The `ui/` primitives are their
  own sub-module ([components/ui/SPEC.md](ui/SPEC.md)).
- **Allowed deps:** React, `@remixicon/react`, `lib` (`shallowEqualArrays` — the reset-keys comparison, shared
  rather than re-stated). Kept dependency-light on purpose, and `lib` is a leaf, so *any* region (shell,
  panels, `main.tsx`) can still wrap in it without creating a cycle.
- **Forbidden:** `store`/`transport`/`panels`/`shell`/`chat`/`contracts`; `server`/`shared`/`pi`; inline
  `style` objects or raw hex (fallback is themed with token utilities only).

## Get right

- **Scope of protection:** React boundaries catch **render + lazy-import** throws only — **not** errors in
  event handlers, effects, or rejected promises (e.g. `transport.request`). Those surface through
  `transport`'s `errorText()` as an error turn/notice, not here. The shell's "panels can't blank the app"
  guarantee is about render/lazy-load; async failures are a separate path.
- Where the error boundary is mounted (each region + the last-resort root wrap) is owned by `shell/SPEC.md`
  and the parent dependency graph in `apps/web/SPEC.md`, not repeated here.
- Quiet-scroll intent is local to its rendered surface, not the workbench's remembered active group. A
  wheel/trackpad gesture need not move DOM focus, while remembered group focus would leave one rail visible
  indefinitely. The third-party frame therefore observes focus and pointer intent at its own host and adds
  only a visual/measurement adapter; it never reads shell placement.
