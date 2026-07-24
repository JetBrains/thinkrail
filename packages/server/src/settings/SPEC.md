---
id: submodule-server-settings
type: submodule-design
status: active
title: settings — server-synced app config
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The server-synced app config — OUR settings (an opaque theme selection today), an extensible `AppConfig`
bag. Reads/merges/persists it and fans changes out to every client, so a preference set on one client
follows the user to the others (architecture #9: shared domain state). The web client owns the available
theme manifests; settings stores only the selected string id.

## Boundary

- **Owns:** the current `AppConfig`; reads are per-request (no cache) — the same file-seeded isolation
  doctrine as `projects.json`/`workspaces.json`. `getConfig()`, `updateConfig(partial)` (merge → persist →
  broadcast), and the `setSettingsPublisher` seam.
- **Public surface (barrel):** `getConfig`, `updateConfig`, `setSettingsPublisher`.
- **Allowed deps:** `persistence` (`loadConfig`/`saveConfig`), `contracts` (`AppConfig`).
- **Forbidden:** importing `host` or any other sibling; owning WS channels — it emits a domain value
  through the injected publisher; `host` maps it onto `settings.changed`.

## Get right

- **Converge on the broadcast, no per-client optimism — with one documented exception.** `updateConfig`
  persists then publishes; the initiating client applies on the `settings.changed` push like everyone
  else (the workspace-lifecycle pattern). The exception: `apps/web/src/onboarding/state.ts`'s writer
  folds the `settings.update` response immediately, through its own serialized client-side write chain,
  so a chained second write can't read a pre-write snapshot — every other writer still converges on the
  push. `getConfig()` is the same value `server.welcome` seeds on connect.
- Theme availability/labels/palettes are not server settings concerns. An id unknown to a given web client
  remains persisted unchanged; that client owns visual fallback.
