---
id: submodule-web-shell
type: submodule-design
status: active
title: shell — responsive frame
parent: module-web
tags: [v1, ui]
---

## Responsibility

The responsive frame and UI composition root: arranges panels into the 3-column desktop layout (and,
later, the mobile single-view-with-switcher).

## Boundary

- **Owns:** `Shell.tsx` — the topbar (wordmark + a compact store-derived **location context** +
  connection-status pill + a Settings gear that opens the store-driven `panels/SettingsDialog` via
  `store.openSettings()` — open state lives in the store, not local, so other surfaces (the Welcome
  provider warning) can open it too) over a body that branches on whether a workspace is active. The
  location context makes scope persistent rather than rail-dependent: an **active workspace** renders two
  lines — `project / workspace display name`, then the monospace git `branch · from baseBranch`; a selected
  project with no active workspace renders `project / Project home`; no project leaves the wordmark alone.
  It follows the existing workspace lifecycle snapshots, so auto-renames update live. Responsive
  degradation drops the base, then the project prefix, before it drops active workspace/branch identity.
  **Active workspace**
  → the resizable 3 columns (projects | center | right-over-terminals). **No active workspace**
  (`activeWorkspaceId == null` — fresh install / after archiving the last one) → the projects rail (kept
  resizable, `resize-left` preserved) beside the `panels/WelcomePanel`; the center/right/terminal surface
  is not mounted. The welcome-state group uses its own `autoSaveId` so it doesn't clobber the 3-column
  layout's saved sizes. Mounts the `panels/Toaster` and `panels/Onboarding` once (outside both layout
  branches) so notifications and the first-run onboarding overlay show over either state.  `Onboarding`
  auto-opens once (guarded by a localStorage "seen" flag) and is re-opened from the projects-rail help
  button via `store.openOnboarding("review")`. **Owns the theme DOM side-effect** — the single place that applies the store's
  (host-owned) opaque `theme` id: a `useEffect` on `store.theme` calls the `themes` module's atomic
  `applyTheme(theme)` + `writeThemeHint(theme)` (the localStorage first-paint cache). The value flows
  store ← transport (welcome /
  `settings.changed`); the shell just performs the swap, so no other component touches `[data-theme]`.
- **Public surface:** `Shell`.
- **Allowed deps:** `panels`, `store` (status + theme + project/workspace context), `transport` (`ConnectionStatus` type), `components/ui`
  (resizable), `components/ErrorBoundary`, `constants` (branding), `themes` (`applyTheme`/`writeThemeHint`).
- **Forbidden:** `server`/`shared`/`pi`; being imported by `panels`/`store`/`transport`.

## Error resilience (why panels can't blank the app)

Panels render (and lazily import) untrusted-shaped data; a throw during render or a failed lazy chunk
(e.g. a stale Vite dep → 504) would otherwise propagate to the React root and unmount the **whole**
tree, leaving the bare gray `--bg-dark` background. So the shell wraps each independently-mounted
region — **center (`CenterTabs`)**, **right (`RightPanel`)**, **terminals (`TerminalsPanel`)** — in its
own `components/ErrorBoundary`, keyed with `resetKeys={[activeWorkspaceId]}` so switching workspace
clears a stuck error. A **last-resort boundary wraps `<Shell />` in `main.tsx`**. `CenterTabs` adds a
per-tab boundary (`resetKeys={[active.id]}`) so one bad tab keeps the tab strip usable. The boundary
detects failed dynamic imports (`isChunkLoadError`) and steers those to a page **reload** (re-fetches
the chunk) rather than an in-place retry. Each region degrades independently — never the whole app.
