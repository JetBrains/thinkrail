---
id: submodule-web-components
type: submodule-design
status: active
title: components — ErrorBoundary primitive (+ ui/)
parent: module-web
tags: [v1, ui, resilience]
---

## Responsibility

The app's single **error-boundary primitive** — the one thing that keeps a panel's render crash or a
failed lazy chunk from unmounting the React root. Also houses the `ui/` sub-module (shadcn primitives),
which has its own spec.

## Boundary

- **Owns:** `ErrorBoundary.tsx` — a class boundary (`getDerivedStateFromError`) that renders a themed,
  self-contained fallback instead of propagating a throw to the root. It:
  - resets a caught error when any `resetKeys` value changes (wire to the subtree's identity —
    workspace/tab id — so navigating away auto-recovers);
  - classifies failed dynamic `import()`s via the pure, unit-tested **`isChunkLoadError`** (stale Vite
    chunk / 504 / Safari "module script failed") and steers those to a page **reload** (re-fetches the
    chunk) rather than an in-place retry;
  - logs the crash to the console (`componentDidCatch`) — the UI already degrades gracefully.
- **Public surface:** `ErrorBoundary`, `isChunkLoadError` — imported directly via
  `@/components/ErrorBoundary` (no barrel). The `ui/` primitives are their own sub-module
  ([components/ui/SPEC.md](ui/SPEC.md)).
- **Allowed deps:** React, `lucide-react`. **Nothing else internal** — kept dependency-light on purpose so
  *any* region (shell, panels, `main.tsx`) can wrap in it without creating a cycle.
- **Forbidden:** `store`/`transport`/`panels`/`shell`/`chat`/`contracts`; `server`/`shared`/`pi`; inline
  `style` objects or raw hex (fallback is themed with token utilities only).

## Get right

- **Scope of protection:** React boundaries catch **render + lazy-import** throws only — **not** errors in
  event handlers, effects, or rejected promises (e.g. `transport.request`). Those surface through
  `transport`'s `errorText()` as an error turn/notice, not here. The shell's "panels can't blank the app"
  guarantee is about render/lazy-load; async failures are a separate path.
- Where the boundary is mounted (each region + the last-resort root wrap) is owned by `shell/SPEC.md` and
  the parent dependency graph in `apps/web/SPEC.md`, not repeated here.
