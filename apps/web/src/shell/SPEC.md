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

- **Owns:** `Shell.tsx` — the resizable 3 columns (projects | center | right-over-terminals), the topbar
  wordmark + connection-status pill + a Settings gear that opens the `panels/SettingsDialog` (M14).
- **Public surface:** `Shell`.
- **Allowed deps:** `panels`, `store` (status), `transport` (`ConnectionStatus` type), `components/ui`
  (resizable), `constants` (branding).
- **Forbidden:** `server`/`shared`/`pi`; being imported by `panels`/`store`/`transport`.
