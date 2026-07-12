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

- **Owns:** `Shell.tsx` — the topbar (wordmark + connection-status pill + a Settings gear that opens the
  store-driven `panels/SettingsDialog` via `store.openSettings()` — open state lives in the store, not local,
  so other surfaces (the Welcome provider warning) can open it too) over a body that branches on whether a workspace is active. **Active workspace**
  → the resizable 3 columns (projects | center | right-over-terminals). **No active workspace**
  (`activeWorkspaceId == null` — fresh install / after archiving the last one) → the projects rail (kept
  resizable, `resize-left` preserved) beside the `panels/WelcomePanel`; the center/right/terminal surface
  is not mounted. The welcome-state group uses its own `autoSaveId` so it doesn't clobber the 3-column
  layout's saved sizes.
- **Public surface:** `Shell`.
- **Allowed deps:** `panels`, `store` (status), `transport` (`ConnectionStatus` type), `components/ui`
  (resizable), `constants` (branding).
- **Forbidden:** `server`/`shared`/`pi`; being imported by `panels`/`store`/`transport`.
