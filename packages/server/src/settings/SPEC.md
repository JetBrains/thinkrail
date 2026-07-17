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

The server-synced app config — OUR settings (theme today), an extensible `AppConfig` bag. Reads/merges/
persists it and fans changes out to every client, so a preference set on one client follows the user to
the others (architecture #9: shared domain state).

## Boundary

- **Owns:** the cached current `AppConfig` (lazy-loaded, so the per-connect `getConfig()` for
  `server.welcome` doesn't hit disk each time); `getConfig()`, `updateConfig(partial)` (merge → persist →
  broadcast), the `setSettingsPublisher` seam, and `resetConfigCache()` (the e2e reset).
- **Public surface (barrel):** `getConfig`, `updateConfig`, `setSettingsPublisher`, `resetConfigCache`.
- **Allowed deps:** `persistence` (`loadConfig`/`saveConfig`), `contracts` (`AppConfig`).
- **Forbidden:** importing `host` or any other sibling; owning WS channels — it emits a domain value
  through the injected publisher; `host` maps it onto `settings.changed`.

## Get right

- **Converge on the broadcast, no per-client optimism.** `updateConfig` persists then publishes; the
  initiating client applies on the `settings.changed` push like everyone else (the workspace-lifecycle
  pattern). `getConfig()` is the same value `server.welcome` seeds on connect.
