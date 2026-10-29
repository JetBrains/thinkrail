---
id: submodule-web-components
type: submodule-design
status: active
title: components — shared UI primitives
parent: module-web
references: [submodule-web-library]
tags: [ui, resilience]
---

## Responsibility

The app's dependency-light shared React primitives: the error boundary that keeps one failed region from
unmounting the root, project-custom icons, the binary attention dot and working-icon treatment used by
feature panels (currently the Projects rail), the quiet-scroll frame, and the shared loading-skeleton
primitive. The shared shadcn primitives live in [[module-ui]] (`@thinkrail/ui/*`), not this module.

## Boundary

- **Owns:** `ErrorBoundary.tsx` — a class boundary (`getDerivedStateFromError`) that renders a themed,
  self-contained fallback instead of propagating a throw to the root. It:
  - resets a caught error when any `resetKeys` value changes (wire to the subtree's identity —
    workspace/tab id — so navigating away auto-recovers);
  - classifies failed dynamic `import()`s via the pure, unit-tested **`isChunkLoadError`** (stale Vite
    chunk / 504 / Safari "module script failed") and steers those to a page **reload** (re-fetches the
    chunk) rather than an in-place retry;
  - logs the crash to the console (`componentDidCatch`) — the UI already degrades gracefully — and hands
    it with the boundary's untranslated `reportId` (never the displayed, translated `label`) to the one
    reporter installed via `setErrorBoundaryReporter` (wired by
    `main.tsx` to the transport's error reports; reporter failures are swallowed). The seam keeps this
    module store/transport-free.
- **`CustomIcon.tsx`** — renders an SVG from `public/custom-icons/` as a themeable `currentColor` glyph
  via a CSS `mask-image` span (`.custom-icon*` classes in `index.css`), so a custom glyph sizes with
  `size-*` and colours with `text-*` exactly like a Remix icon. Names are a typed union
  (`CustomIconName`); today: `file-diff-line`/`file-diff-fill` (the Changes review tab glyph).
- **`QuietScrollArea.tsx`** — the store-free overflow observer and two presentation surfaces:
  `QuietScrollArea` owns an ordinary native scroll viewport (an optional `viewportRef` callback hands that
  element to a caller that saves/restores its scroll, e.g. `panels/RememberedScrollArea`), while `QuietScrollFrame` observes a
  third-party descendant scroll control without taking over its content or input and can receive the
  library's authoritative edge state. `styles/global.css` owns the single scrollbar definition for every
  native scroll container: a 6px gutter, transparent track, transparent resting thumb, `--border-default`
  while the scrolling element is hovered or carries `data-quiet-scroll-intent`, and `--text-muted` on
  direct thumb hover/active. The reveal travels through an element-level custom property
  (`--scrollbar-thumb`) that the thumb pseudo-element and Firefox's `scrollbar-color` both read, because
  Chromium evaluates `:hover` inside a `::-webkit-scrollbar-*` selector against the scrollbar part, not
  the element; every element resets the property so a hovered ancestor never reveals its descendants. Bundled high-contrast
  themes keep a 2px resting hairline; OS forced-colours keeps a system-colour thumb and removes curtains;
  reduced motion removes transitions. `QuietScrollArea` and `QuietScrollFrame` therefore own no look: they
  add intent beyond hover (focus-within, active scrolling with a short grace period, pointer drags that
  leave the frame, touch), overflow measurement, and pointer-transparent 16px edge curtains on clipped
  directions. `QuietScrollFrame` also re-skins xterm's non-native slider to the same thumb (transparent
  underlying slider, a 6px optical thumb, opacity gated on intent and measured vertical overflow).
  Surface colour is an explicit semantic prop (`sidebar` or `terminal`), never inferred from arrangement.
- **`AttentionDot.tsx`** — the store-free, static green/accent dot whose sole accessible label is “Needs
  attention.” It carries no reason, count, tooltip, motion, or clearing behavior; callers decide only whether
  it is present. It is the one marker for both needs-input and unread-result attention.
- **`RunningIcon.tsx`** — the store-free **“ThinkRail is working” badge**: the brand monogram inside a
  rounded-square frame, drawn in `currentColor` so it sizes with `size-*` and colours with `text-*` like a
  Remix icon, with the accessible label “Agent working”. While motion is allowed, the frame (two halves
  leaving a gap on the left and meeting on the right) and the six letter strokes of the monogram draw and
  erase on one 3.263s cycle (`loader-*` keyframes in `index.css`); a beat with only the frame showing is
  part of the design. Each letter stroke is a wide line clipped to its region of `BRAND_MARK_SEGMENTS`, the
  same segments `BRAND_MARK_PATH` is joined from, so the fully drawn badge is the shell's mark rather than a
  second copy that could drift. Only the stroke centre-lines, the frame, and the small gap between the R's
  stem and top bar (the stem stroke stops short) are local animation geometry. Reduced motion leaves every
  stroke at its fully drawn dash: the static, complete badge. This loader replaced a ring with a lapping
  train and a pulsing monogram; before that the row's own identity glyph breathed, dropped because a
  dimming folder reads as “disabled” at 14px. Callers pass only size/colour classes and decide from
  normalized host state whether a top-level session is running; the icon renders no dot, spinner, count,
  tooltip, or idle state.
- **Also governs (implementation in `@thinkrail/ui/skeleton`, [[module-ui]], so the app and
  [[module-resource-renderers]] share it):** `SkeletonRows`, the one pulsing-rows placeholder every loading surface
  uses, and `LoadingRegion`, the sized-wrapper shape around it that most call sites actually want (a
  `className` for the region's own padding/sizing, an optional `label` threaded to `SkeletonRows`'
  `role="status"` region rather than opening a second one, and an optional `testId`). The full loading
  vocabulary and its rules are below.
- **Also owns:** `preloadedLazy.tsx` — a split-chunk component plus `preload()`. Plain `lazy` suspends on
  its first render even when the chunk is cached; under a sync store update React then holds the
  fallback ~300ms. A mount that finds the chunk loaded renders it directly; a mount never swaps component
  type. Call `preload()` when the owning screen mounts, not at boot, so other screens never fetch the
  chunk. A failed load reaches the `ErrorBoundary` as with plain `lazy`; renders never retry it, only the
  next `preload()` does. Known limit: on a slow link, or when the revealing data is already in the store
  at mount, the first mount still takes the `lazy` path.
- **Public surface:** `ErrorBoundary`, `isChunkLoadError` — imported directly via
  `@/components/ErrorBoundary` (no barrel; the placeholders come from `@thinkrail/ui/skeleton`); `AttentionDot` via
  `@/components/AttentionDot`; `RunningIcon` via `@/components/RunningIcon`; `CustomIcon`,
  `CustomIconName` via `@/components/CustomIcon`; `QuietScrollArea`, `QuietScrollFrame`, and the
  `QuietScrollEdges` type via `@/components/QuietScrollArea`; `preloadedLazy` via
  `@/components/preloadedLazy`; `useNow()` via `@/components/useNow` (the
  wall clock as a `useSyncExternalStore` value on a shared 30 s ticker, so a render never calls `Date.now`
  itself).
- **Allowed deps:** React, `@remixicon/react`, `@thinkrail/ui/utils` (`cn`), `@thinkrail/ui/button` (the
  error fallback's Reload / Try again are shared buttons), `@thinkrail/locales` (UI strings), `lib` (`shallowEqualArrays` — the reset-keys comparison, shared
  rather than re-stated), `constants` (`BRAND_MARK_SEGMENTS` — the monogram regions `RunningIcon` clips to,
  shared with the shell logo rather than copied). Kept dependency-light on purpose, and both are leaves, so *any* region
  (shell, panels, `main.tsx`) can still wrap in it without creating a cycle.
- **Forbidden:** `store`/`transport`/`panels`/`shell`/`chat`/`contracts`; `server`/`shared`/`pi`; inline
  `style` objects or raw hex (fallback is themed with token utilities only).

## Loading vocabulary

The two-tier loading vocabulary (`SkeletonRows` / `LoadingRegion` for a content region, `Loader2` spinner for
an in-flight action pinned to its control) and its rules are a pattern page of the component library
([[submodule-web-library]], `apps/web/library/content/patterns/loading.md`).

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
