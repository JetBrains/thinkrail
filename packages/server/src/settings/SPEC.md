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

The server-synchronized app config: opaque theme selection, analytics switch, terminal replay budget, chat
composer growth preset, bounded custom layout-preset catalog, and plan-review policy. `reviewModel` /
`reviewEffort` select the reviewer/reflector runtime (unset means pi default); `reviewAutoFix: false` records a
`request_changes` verdict and waits instead of auto-sending a fix. The module reads, normalizes, persists,
caches, and broadcasts values that intentionally follow the owner across frontends.

Current workbench frame, workspace resource placement, current/default preset selection, side/bottom group limits, selection, and focus are explicitly absent. Those are frontend-surface-local view state under [[submodule-web-shell-layout-state]]. Built-in layout presets remain web-owned.

A numeric setting is bounded by its consumer when the domain owns the safety cap—for example `terminal`
clamps `terminalReplayKb`, so a hand-edited config cannot exhaust memory. Settings itself validates custom
layout presets because it owns their cross-frontend storage contract.

## Boundary

- **Owns:** cached current `AppConfig`; `getConfig()`; `updateConfig(partial)` (merge → validate known fields → persist → broadcast); resource-free custom-preset validation/normalization and safety caps; `setSettingsPublisher`; and `resetConfigCache` for tests.
- **Public surface (barrel):** `getConfig`, `updateConfig`, `setSettingsPublisher`, `resetConfigCache`, plus pure custom-preset normalization used by host startup after persistence load.
- **Allowed deps:** `persistence` (`loadConfig`/`saveConfig`); `contracts` (`AppConfig`, `LayoutPreset`).
- **Forbidden:** host or another feature sibling; current-layout document/snapshot types; workspace ids/resources; current frame validation; owning WS channels; or importing web preset definitions.

## Get right

- **Converge on broadcast, no client optimism.** `updateConfig` persists before publishing; every frontend, including the initiator, adopts `settings.changed`. `server.welcome` seeds the same cached value.
- Theme availability/labels/palettes are not server concerns. Unknown theme ids remain persisted; each independently shipped frontend resolves visual fallback.
- Custom layout presets are a complete top-level catalog replacement, not a nested per-item patch. Each value is bounded, resource-free, uniquely identified, and contains no workspace/tab/session/terminal identity. A malformed member is isolated during persisted-config normalization; a wire mutation with any malformed member is rejected as a whole. On first load after upgrade, `customLayoutPresets` falls back to the old `layout.customPresets` value; old host-wide default/limit fields are intentionally discarded because their replacements are surface-local.
- Deleting or editing a custom preset changes only the shared definition. It cannot mutate any frontend's instantiated frame or local default selection.
- `null` clears optional `reviewModel`/`reviewEffort` overrides; it is a wire-only sentinel and never persists.
