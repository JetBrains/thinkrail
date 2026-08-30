---
id: submodule-web-shell-layout-state
type: submodule-design
status: active
title: shell/layoutState — frontend-local layout ownership
parent: submodule-web-shell
depends-on: [module-contracts]
tags: [layout, local-state, persistence]
---

## Responsibility

Own one frontend surface's current workbench state: initialize the singular resource-free frame, hydrate and persist its per-workspace views/attention and local layout preferences, and commit atomic frame-plus-view mutations into Zustand.

## Boundary

- **Owns:** the versioned local document and validation boundary; backend-endpoint/surface-qualified storage identity; pristine Balanced initialization; hydration and best-effort persistence lifecycle; local default/limit preferences; atomic commit helpers that install pure `layout/` results; and workspace cleanup.
- **Public surface (`index.ts`):** the mounted hydration/persistence hook, local layout commit and workspace-initialization entry points, surface-state readiness, and deterministic storage seams for tests.
- **External deps:** browser storage/session primitives, Web Locks with a `BroadcastChannel` claim fallback, React, `transport` for endpoint identity and error normalization, and `@thinkrail/contracts` only for the synchronized `LayoutPreset` type.
- **Forbidden:** any current-layout request or push; optimistic revision/conflict queues; feature rendering; domain resource lifetime; importing server/shared/pi; reading old host snapshots or old browser attention keys; or putting browser storage calls in the Zustand store.

The live state belongs to one browser tab or native window. Browser keys are qualified by transport endpoint and a session-restorable surface id; native adapters use `{ backendProfileId, windowId }`. Before reading that key, the browser claims the endpoint/id for the live document through an origin-local Web Lock, falling back to a bounded `BroadcastChannel` occupancy probe. A copied id already claimed by another live tab is reminted and written back to the clone's session storage; reload releases and reacquires the same id. The claim channel carries identity probes only—never frame or workspace state. The shell initializes this state even on Welcome, before any workspace is open, so local default/limit edits are immediately durable. A missing, invalid, or future local document starts directly from the Balanced frame. Previously persisted host snapshots and old attention entries remain untouched and inert. Simultaneous surfaces never consume each other's storage events. Persistence failure leaves live state usable.

A newly opened workspace receives an empty local view projected through the surface's current frame; host domain hydration subsequently populates only resources the surface explicitly opens or passively owns, such as its deterministic initial terminal. A frame mutation and every required workspace-view remap are one store transaction and one persisted local document. Projected callbacks carry their rendered base; a stale callback rebases only the top-level regions it actually changed onto the latest projection, so nested resize/layout effects cannot revert a newer region. Closing a resource changes only its workspace view. Empty frame groups survive. Explicit group removal/merge and preset application may change topology, so their pure result includes deterministic remaps for every retained workspace view; no view may reference a removed group after commit.
