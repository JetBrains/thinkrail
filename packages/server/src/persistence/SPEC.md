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

Durable app state — projects, workspaces, and the server-synced app config — as JSON under the data dir.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`);
  `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces`, and `loadConfig`/`saveConfig`
  (`config.json`, merged over `DEFAULT_CONFIG` so a missing file or key degrades cleanly) — all
  tab-indented JSON.
- **Public surface (barrel):** `dataDir`, `loadProjects`, `saveProjects`, `loadWorkspaces`,
  `saveWorkspaces`, `loadConfig`, `saveConfig`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`AppConfig` types + `DEFAULT_CONFIG`); Node
  `fs`/`os`/`path`.
- **Forbidden:** importing any sibling module or `host` — this is a leaf others depend on.
