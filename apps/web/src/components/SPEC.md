---
id: submodule-web-components
type: submodule-design
status: active
title: components — shared UI primitives
parent: module-web
tags: [v1, ui, resilience]
---

## Responsibility

The app's dependency-light shared React primitives: the error boundary that keeps one failed region from
unmounting the root, project-custom icons, the quiet-scroll frame used by shell and feature panels, and
the shared loading-skeleton primitive. Also houses the `ui/` sub-module (shadcn primitives), which has
its own spec.

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
  third-party descendant scroll control without taking over its content or input and can receive the
  library's authoritative edge state. Native areas use the shared 6px scrollbar gutter, revealing a 5px
  optical thumb on hover/focus-within/drag/active scrolling and the full 6px thumb on direct hover. A
  third-party frame preserves that library's wider hit geometry while replacing only the optical slider;
  the underlying slider stays transparent through its base, hover, and active states. Authoritative edges
  also declare vertical overflow, so xterm's controller can remain visible for local intent and accessibility
  modes only when scrollback exists. Pointer intent lasts through release or cancellation, including a drag
  that leaves the frame. Both surfaces paint pointer-transparent 16px curtains only on clipped directions.
  Native measurement follows scroll, viewport/content resize, and descendant replacement. Bundled
  high-contrast themes retain a resting hairline; OS forced-colours mode keeps a visible system-colour thumb
  and removes the cosmetic curtains; reduced motion removes both optical and third-party controller opacity
  transitions. Surface colour is an explicit semantic prop (`sidebar` or `terminal`), never inferred from
  arrangement.
- **Also owns:** `Skeleton.tsx` — `SkeletonRows`, the one pulsing-rows placeholder every loading surface
  uses (tool panels, project tree expansion, Monaco editor/diff boot, settings lists, plan tabs). One
  primitive, not per-panel ad-hoc "Loading…" lines: a loading state must occupy content-shaped space so
  the arriving data replaces it without the layout jumping. The app's loading vocabulary is exactly
  **two-tier**: `SkeletonRows` for a *content region* — any area that will fill with substantial content,
  however that region is framed (a tool panel, a dialog's list, a menu's list section, **or a tab
  body/Suspense fallback restoring a chat, plan, or editor** — size of surface, not its container, decides
  the tier) — and a `Loader2` spinner (usually beside a short label) for an *in-flight action or transient
  state* pinned to its control (a button, a single menu item, an icon). A spinner centred in a large empty
  region reads as a different, heavier kind of wait than the content-shaped skeleton used one panel over
  for the same "data is on the way" situation, so it is never the right choice for a region —
  `shell/WorkspaceWorkbench.tsx`'s `MissingResource` (the chat/plan/editor tab-body and Suspense
  fallback), `panels/ExistingWorktreeDialog.tsx`'s worktree-candidate list, and
  `panels/ChangesScopeMenu.tsx`'s commit list all render `SkeletonRows` for exactly this reason. Bare
  "Loading…" text without either is a defect.
- **Public surface:** `ErrorBoundary`, `isChunkLoadError`, `SkeletonRows` — imported directly via
  `@/components/ErrorBoundary` / `@/components/Skeleton` (no barrel); `CustomIcon`, `CustomIconName` via
  `@/components/CustomIcon`; `QuietScrollArea`, `QuietScrollFrame`, and the `QuietScrollEdges` type via
  `@/components/QuietScrollArea`. The `ui/` primitives are their own sub-module
  ([components/ui/SPEC.md](ui/SPEC.md)).
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
