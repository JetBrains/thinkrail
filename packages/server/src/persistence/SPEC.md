---
id: submodule-server-persistence
type: submodule-design
status: active
title: persistence — JSON app state
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Durable host state—projects, workspaces, cross-frontend app config, terminal catalogs, and installation identity—as JSON under the data dir. Current workbench frame and workspace placement are frontend-local and have no host persistence.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`); project/workspace/config load-save operations; fieldwise config validation over `DEFAULT_CONFIG` while preserving unknown top-level extension fields; and installation state in server-only `installation.json` (`{ id, appInstalled?: true }`). `id` is the non-rotating per-install UUID and is never wire-broadcast; the optional marker is shared by binary and desktop analytics initialization.
- **Public surface (barrel):** `dataDir`, project/workspace/config and terminal-catalog load-save operations, `ensureInstallation()` returning only `{ id }`, and narrow `claimAppInstalled()` marker persistence. Claiming writes complete JSON to a unique temporary file beside `installation.json`, atomically renames it over the record, and removes the temporary file if replacement fails; the old id/record therefore remains retryable. No cross-process lock is provided.
- **Allowed deps:** `contracts` (`Project`, `Workspace`, `AppConfig`, `LayoutPreset`, `DEFAULT_CONFIG`,
  `isTerminalWindowsShell`); Node `fs`/`os`/`path`.
- **Forbidden:** importing feature siblings or `host`; persisting a current frame/view, selection/focus, or frontend-surface identity; reading alternate config keys or old schemas; or reading, rewriting, or deleting old host layout snapshots.

Analytics config preserves a saved boolean preference and a valid `analyticsConsentConfirmed` boolean
independently; absent/malformed values default false. A preference-only write never implies completion.
Settings owns initial preference priming and preference-plus-confirmation writes.

Config validation normalizes the closed theme mode plus complete opaque system pair, the closed
composer-growth preference, the closed Windows terminal-shell preference (invalid/absent →
`DEFAULT_CONFIG.terminalWindowsShell`), chat/file line widths plus their pane-bound switches, and the
JetBrains quota boolean + whole `1–3600` second cadence over their defaults; it accepts only the current bounded
`customLayoutPresets` catalog as synchronized layout data. Current/default preset ids, group limits, and
chat message order are not config fields; retired config shapes are stripped rather than upgraded or
preserved as extensions. Historical `layouts/` files remain untouched and inert.
