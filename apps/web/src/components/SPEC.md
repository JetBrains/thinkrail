---
id: submodule-web-components
type: submodule-design
status: active
title: components — ErrorBoundary + Tip primitives (+ ui/)
parent: module-web
tags: [v1, ui, resilience]
---

## Responsibility

The app's single **error-boundary primitive** — the one thing that keeps a panel's render crash or a
failed lazy chunk from unmounting the React root — plus the shared **tooltip helper** (`Tip`) every
control uses. Also houses the `ui/` sub-module (shadcn primitives), which has its own spec.

## Boundary

- **Owns:** `ErrorBoundary.tsx` — a class boundary (`getDerivedStateFromError`) that renders a themed,
  self-contained fallback instead of propagating a throw to the root. It:
  - resets a caught error when any `resetKeys` value changes (wire to the subtree's identity —
    workspace/tab id — so navigating away auto-recovers);
  - classifies failed dynamic `import()`s via the pure, unit-tested **`isChunkLoadError`** (stale Vite
    chunk / 504 / Safari "module script failed") and steers those to a page **reload** (re-fetches the
    chunk) rather than an in-place retry;
  - logs the crash to the console (`componentDidCatch`) — the UI already degrades gracefully.
- **Owns:** `Tip.tsx` — the shared tooltip wrapper over `ui/tooltip` (the one primitive; controls never
  hand-roll their own). **`Tip({ label, side, children })`** wraps a single control element
  (`TooltipTrigger asChild` + themed `TooltipContent`); it composes with a nested `DropdownMenuTrigger`/
  `PopoverTrigger` (both `asChild`) so a control that already triggers a menu/popover keeps one trigger.
  **`useIsTruncated<T>()`** returns `{ ref, truncated }` — measures `scrollWidth > clientWidth` after
  each render + on resize — so callers show a full-text tooltip **only when a label is actually clipped**
  (project/workspace rows, breadcrumb). Open/close is transient Radix-owned state (never persisted). The
  app mounts **one `TooltipProvider`** (hover delay ~450ms + focus) at the root in `main.tsx`.
- **Public surface:** `ErrorBoundary`, `isChunkLoadError` (via `@/components/ErrorBoundary`); `Tip`,
  `useIsTruncated` (via `@/components/Tip`) — imported directly (no barrel). The `ui/` primitives are
  their own sub-module ([components/ui/SPEC.md](ui/SPEC.md)).
- **Allowed deps:** React, `lucide-react` (`ErrorBoundary` stays this light on purpose so *any* region can
  wrap in it without a cycle); `Tip` additionally uses `components/ui` (`tooltip`). **Nothing else
  internal.**
- **Forbidden:** `store`/`transport`/`panels`/`shell`/`chat`/`contracts`; `server`/`shared`/`pi`; inline
  `style` objects or raw hex (fallback + tooltip are themed with token utilities only).

## Get right

- **Scope of protection:** React boundaries catch **render + lazy-import** throws only — **not** errors in
  event handlers, effects, or rejected promises (e.g. `transport.request`). Those surface through
  `transport`'s `errorText()` as an error turn/notice, not here. The shell's "panels can't blank the app"
  guarantee is about render/lazy-load; async failures are a separate path.
- Where the boundary is mounted (each region + the last-resort root wrap) is owned by `shell/SPEC.md` and
  the parent dependency graph in `apps/web/SPEC.md`, not repeated here.
