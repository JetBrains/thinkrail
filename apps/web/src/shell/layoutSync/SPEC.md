---
id: submodule-web-shell-layout-sync
type: submodule-design
status: deprecated
title: shell/layoutSync — legacy host-layout synchronization
parent: submodule-web-shell
tags: [layout, synchronization, optimistic]
---

## Responsibility

Historical browser synchronization for host-owned per-workspace layout snapshots. [[submodule-web-shell-layout-state]] replaces it; no new-client current-layout behavior may be added here.

## Boundary

The frontend-local-layout change removes this implementation rather than retaining an old-client path. The new workbench does not import its hydration, optimistic commit, attention persistence, conflict, or broadcast-folding surface. Legacy snapshot **reading** for one-time local migration belongs to `layoutState/`, not here.

Delete this module, its queue/conflict tests, and this spec when `layoutState/` lands. Until then it must not become a dependency of `layout/`, feature panels, domain reconciliation, or the new Zustand state model.
