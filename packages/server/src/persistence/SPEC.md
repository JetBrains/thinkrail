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

Durable host state—projects, workspaces, cross-frontend app config, terminal catalogs, installation identity, and server-only acquisition state—as JSON under the data dir. Current workbench frame and workspace placement are frontend-local and have no host persistence.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`); project/workspace/config load-save operations; fieldwise config validation over `DEFAULT_CONFIG` while preserving unknown top-level extension fields; installation state in server-only `installation.json` (`{ id, appInstalled?: true }`), and campaign-only browser-attribution state in separate server-only `attribution.json`. `id` is the non-rotating per-install UUID and is never wire-broadcast; the optional install marker is shared by binary and desktop analytics initialization.
- **Public surface (barrel):** `dataDir`, project/workspace/config and terminal-catalog load-save operations, `ensureInstallation()` returning only `{ id }`, narrow install/attribution claim operations, and strict acquisition read/save. The first browser attempt exclusively creates `{ browserClaimAttempted: true }` with `wx`; success writes a complete strict first/last-touch record to a unique sibling temporary file and atomically replaces it. Retention is 30 days from `last_touch`; reading an expired or invalid acquisition atomically restores the terminal marker. Replacement failure cleans the temporary file and retains the terminal marker. No claim/verifier/challenge/URL, journey/bridge id, IP, or user agent is accepted by the persisted schema. No cross-process lock is provided.
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
