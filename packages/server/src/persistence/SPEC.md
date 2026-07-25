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

Durable app state — projects, workspaces, the server-synced app config, and the install identity —
as JSON under the data dir.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`);
  `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces`, `loadConfig`/`saveConfig`
  (`config.json`, merged over `DEFAULT_CONFIG` so a missing file or key degrades cleanly), and
  `ensureInstallation`/`saveInstallation` (**`installation.json`** — `{ id, announced }`, the
  per-install uuid4 + the `app_installed`-sent bit; **server-only by design**: it must never ride
  the wire-broadcast `config.json` — see `submodule-server-analytics`; `ensureInstallation` mints
  the id on first read and never rotates it) — all tab-indented JSON.
- **Public surface (barrel):** `dataDir`, `loadProjects`, `saveProjects`, `loadWorkspaces`,
  `saveWorkspaces`, `loadConfig`, `saveConfig`, `ensureInstallation`, `saveInstallation`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`AppConfig` types + `DEFAULT_CONFIG`); Node
  `fs`/`os`/`path`.
- **Forbidden:** importing any sibling module or `host` — this is a leaf others depend on.
