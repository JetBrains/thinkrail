---
id: submodule-web-shell-terminal-reconciliation
type: submodule-design
status: active
title: shell/terminalReconciliation — terminal catalog and placement convergence
parent: submodule-web-shell
tags: [terminal, layout, reconciliation]
---

## Responsibility

Reconcile the host-authoritative terminal catalog with shared layout references while keeping PTY lifetime
and browser-local attention separate from placement.

## Boundary

- **Owns:** authoritative-catalog advancement tracking; pruning placements only after catalog readiness;
  passive restoration of confirmed domain tabs; title refresh; placement of pre-layout/recovered terminals;
  and deferring catalog completion until any resulting optimistic layout projection settles.
- **Public surface (`index.ts`):** the mounted terminal placement/catalog reconciliation hook and terminal
  placement-id helper used by intent processing.
- **External deps:** contracts terminal/layout types; store terminal catalog state; the panel-owned terminal
  catalog hydration hook; React.
- **Forbidden:** creating/attaching/closing PTYs, controlling terminal stream ownership, selecting a remotely
  restored terminal, direct WS calls, panel rendering, server/shared/pi imports, or treating layout references
  as terminal existence proof.

New reservation-pending terminals remain behind their explicit placement intents until the host catalog
confirms them. A catalog terminal with no
placement passively restores into the last available bottom group (creating a hidden slot within the bottom
limit when needed), preserving bottom visibility and never stealing attention. Existing placed terminals,
including version-1 center/side placements, never move merely because bottom now exists.
