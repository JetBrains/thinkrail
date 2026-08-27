---
id: submodule-web-shell-terminal-reconciliation
type: submodule-design
status: active
title: shell/terminalReconciliation — terminal catalog and local placement convergence
parent: submodule-web-shell
tags: [terminal, layout, reconciliation]
---

## Responsibility

Reconcile the host-authoritative terminal catalog with one frontend surface's workspace-local terminal references while keeping PTY lifetime, frame geometry, and workspace attention separate.

## Boundary

- **Owns:** authoritative-catalog advancement tracking; pruning local references only after catalog readiness; title refresh; and passive local seeding of the deterministic initial terminal when absent from this surface's workspace view.
- **Public surface (`index.ts`):** the mounted terminal catalog/local-placement reconciliation hook and terminal placement-id helper used by intent processing.
- **External deps:** contracts terminal types; store terminal catalog and local workspace-view state; the panel-owned catalog hydration hook; React.
- **Forbidden:** creating/attaching/closing PTYs; terminal stream ownership; selecting a passively recovered terminal; changing frame topology/geometry to accommodate catalog state; direct WS calls; panel rendering; server/shared/pi imports; current-layout transport; or treating a local reference as terminal existence proof.

Reservation-pending terminals stay behind their initiating surface's explicit placement intent until the host catalog confirms them. A confirmed deterministic initial terminal absent from the local workspace view is seeded without selection into an existing compatible slot, preferring bottom and falling back to the last-focused center group; recovery never implicitly reshapes the frame. Other catalog terminals never gain placement merely because another frontend created them. Existing local placements never move merely because another frontend moved the same host terminal in its own view.

Catalog removal prunes every local reference to that terminal after readiness and reconciles attention. Explicit host terminal close remains the only PTY-lifetime action; local frame moves and preset application preserve catalog identity.
