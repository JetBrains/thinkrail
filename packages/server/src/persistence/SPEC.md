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

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`); project/workspace/config load-save operations; fieldwise config validation over `DEFAULT_CONFIG` while preserving unknown top-level extension fields; and `ensureInstallation` / `saveInstallation` over `installation.json` (`{ id, announced }`, the non-rotating per-install uuid4 plus `app_installed`-sent bit, server-only and never wire-broadcast). JSON remains tab-indented.
- **Public surface (barrel):** `dataDir`, project/workspace/config and terminal-catalog load-save operations, and installation identity operations.
- **Allowed deps:** `contracts` (`Project`, `Workspace`, `AppConfig`, `LayoutPreset`, `DEFAULT_CONFIG`); Node `fs`/`os`/`path`.
- **Forbidden:** importing feature siblings or `host`; persisting a current frame/view, selection/focus, or frontend-surface identity; reading alternate config keys or old schemas; or reading, rewriting, or deleting old host layout snapshots.

Config validation accepts only the current bounded `customLayoutPresets` catalog as synchronized layout data. Current/default preset ids and group limits are not config fields, and retired config shapes are ignored rather than upgraded. Historical `layouts/` files remain untouched and inert.
