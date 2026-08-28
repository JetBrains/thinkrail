---
id: submodule-web-shell-layout-state
type: submodule-design
status: active
title: shell/layoutState — frontend-local layout ownership
parent: submodule-web-shell
depends-on: [module-contracts]
tags: [layout, local-state, persistence, migration]
---

## Responsibility

Own one frontend surface's current workbench state: initialize the singular resource-free frame, hydrate and persist its per-workspace views/attention and local layout preferences, commit atomic frame-plus-view mutations into Zustand, and perform the bounded one-time import from legacy host snapshots.

## Boundary

- **Owns:** the versioned local document and validation boundary; backend-endpoint/surface-qualified storage identity; hydration and best-effort persistence lifecycle; local default/limit preferences; atomic commit helpers that install pure `layout/` results; workspace cleanup; and the attempted-import marker that prevents legacy re-adoption.
- **Public surface (`index.ts`):** the mounted hydration/persistence hook, local layout commit entry points, surface-state readiness, and deterministic storage/import seams for tests.
- **External deps:** browser storage/session primitives, Web Locks with a `BroadcastChannel` claim fallback, and React. `@thinkrail/contracts` is temporary and type-only for the legacy snapshot read plus the durable custom-preset DTO; current frame/view types are web-local.
- **Forbidden:** publishing current state over transport; accepting `layout.changed`; optimistic revision/conflict queues; feature rendering; domain resource lifetime; importing server/shared/pi; or putting browser storage calls in the Zustand store.

The live state belongs to one browser tab or native window. Browser keys are qualified by transport endpoint and a session-restorable surface id; native adapters use `{ backendProfileId, windowId }`. Before reading that key, the browser claims the endpoint/id for the live document through an origin-local Web Lock, falling back to a bounded `BroadcastChannel` occupancy probe. A copied id already claimed by another live tab is reminted and written back to the clone's session storage; reload releases and reacquires the same id. The claim channel carries identity probes only—never frame or workspace state. The shell initializes this state even on Welcome, before any workspace is open, so local default/limit edits are immediately durable; a pristine bootstrap still yields to the first legacy snapshot during the compatibility import. Simultaneous surfaces never consume each other's storage events. Invalid or future local schemas fall back to the Balanced safe frame; the persisted default is used by the explicit Reset frame command. Persistence failure leaves live state usable.

A frame mutation and every required workspace-view remap are one store transaction and one persisted local document. Projected callbacks carry their rendered base; a stale callback rebases only the top-level regions it actually changed onto the latest projection, so nested resize/layout effects cannot revert a newer region. Closing a resource changes only its workspace view. Empty frame groups survive. Explicit group removal/merge and preset application may change topology, so their pure result includes deterministic remaps for every retained workspace view; no view may reference a removed group after commit.

During the compatibility release only, a surface with no local record reads each workspace's legacy snapshot at most once. The first available snapshot supplies the frame and its own resource view; later snapshots contribute resource placement only, mapped into the existing frame. Both presence and absence are marked attempted. The module never sends `layout.replace` or folds `layout.changed`; the dependency and importer disappear with the next protocol version.
