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

The server-synced app config — OUR settings (an opaque theme selection, the analytics switch, terminal
replay budget, and workbench default/custom presets + side-group limit), an extensible `AppConfig` bag.
Reads/merges/persists it and fans changes out to every client,
so a preference set on one client follows the user to the others (architecture #9: shared domain state). The
web client owns the available theme manifests; settings stores only the selected string id.

**A numeric setting is clamped by its consumer, not here** — `terminalReplayKb` sizes a per-terminal buffer, so
`terminal` bounds it against `TERMINAL_REPLAY_KB` on read. This bag persists what it is given; a hand-edited
`config.json` must not be able to exhaust memory.

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
- Theme availability/labels/palettes are not server settings concerns. An id unknown to a given web client
  remains persisted unchanged; that client owns visual fallback.
- `settings.update` remains a top-level partial merge; a supplied `layout` field is a complete validated
  `LayoutSettings` replacement, never a nested partial that could drop catalog/default/limit siblings.
- Layout preset payloads are portable structure/tool placement only; settings never accepts workspace
  resource identities in a preset. `host` runs custom payloads through `layout`'s portable-preset validator
  before calling settings, preserving sibling boundaries without duplicating the parser. Built-in definitions
  may evolve with the independently shipped UI, while the host preserves the selected opaque id and custom
  payloads.
