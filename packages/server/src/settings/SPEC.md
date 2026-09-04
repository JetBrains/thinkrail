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

The server-synchronized app config: opaque fixed-theme selection, fixed/system mode and optional light/dark
pair, analytics switch, terminal replay budget, chat composer growth preset, bounded custom layout-preset
catalog, the host-wide subagent default, and plan-review policy. `reviewModel` /
`reviewEffort` select the reviewer/reflector runtime (unset means pi
default); `reviewAutoFix: false` records a `request_changes` verdict and waits instead of auto-sending a fix.
The module reads, normalizes, persists, caches, and broadcasts values that intentionally follow the owner
across frontends.

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

- **Converge on broadcast, no client optimism.** `updateConfig` persists before replacing the live cache or publishing; a failed write changes neither runtime reads nor frontends. Every frontend, including the initiator, adopts `settings.changed`. `server.welcome` seeds the same cached value.
- `subagentsEnabled` defaults to `true` when absent so old config preserves current behavior; a present non-boolean update is rejected before cache, persistence, or broadcast changes. Settings owns only that global default; workspace override and effective-value resolution stay outside this module.
- Theme availability/labels/palettes, operating-system appearance, and the effective theme are not server concerns. `theme` remains the opaque fixed choice; `themeMode` defaults to `"fixed"`, and `systemThemePair` remains absent until first use. A persisted pair is retained only when both slots are strings; malformed pairs are dropped, and system mode without a retained pair normalizes to fixed without replacing a valid fixed id. A missing/invalid mode also normalizes to fixed while an independently valid dormant pair may survive. Entering system mode requires a complete valid-shaped existing-or-incoming pair; a pair mutation replaces both slots atomically. Unknown ids remain persisted for each independently shipped frontend to resolve by required appearance.
- A `settings.update` carrying `theme` without explicit `themeMode` is a legacy-compatible fixed-theme action and sets mode to `"fixed"`. Thus an old client connected to a system-configured host can never appear to change only itself: its deliberate theme choice exits system mode through the ordinary persist-before-broadcast path.
- Retired host-layout and chat-message-order fields are ignored rather than persisted or broadcast. Layout instantiation and transcript order are frontend-local preferences.
- Custom layout presets are a complete top-level catalog replacement, not a nested per-item patch. Each value is bounded, resource-free, uniquely identified, uses only the current preset schema, and contains no workspace/tab/session/terminal identity. A malformed persisted member is isolated during config validation; a wire mutation with any malformed member is rejected as a whole. No alternate config key or old preset schema is read or upgraded.
- Deleting or editing a custom preset changes only the shared definition. It cannot mutate any frontend's instantiated frame or local default selection.
- `null` clears optional `reviewModel`/`reviewEffort` overrides; it is a wire-only sentinel and never persists.
