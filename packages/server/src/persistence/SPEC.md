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

Durable app state — projects, workspaces, server-synced app config, per-workspace workbench snapshots,
and the install identity — as JSON under the data dir.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`);
  `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces`, `loadConfig`/`saveConfig`
  (`config.json`, fieldwise-normalized over `DEFAULT_CONFIG`—including the closed composer-growth preset and
  both nested layout group limits—so a missing/invalid known value or key degrades cleanly, while unknown
  top-level extension fields survive known-field updates),
  `loadWorkspaceLayout`/`loadWorkspaceLayoutBackup`/`saveWorkspaceLayout`/`removeWorkspaceLayout`
  (versioned full snapshots in traversal-safe workspace-keyed filenames; atomic replacement with a
  last-known-good copy so a torn/corrupt write cannot blank a workspace; complete cleanup when its
  workspace is archived), and
  `ensureInstallation`/`saveInstallation` (**`installation.json`** — `{ id, announced }`, the
  per-install uuid4 + the `app_installed`-sent bit; **server-only by design**: it must never ride
  the wire-broadcast `config.json` — see `submodule-server-analytics`; `ensureInstallation` mints
  the id on first read and never rotates it) — all tab-indented JSON.
- **Public surface (barrel):** `dataDir`, `loadProjects`, `saveProjects`, `loadWorkspaces`,
  `saveWorkspaces`, `loadConfig`, `saveConfig`, `loadWorkspaceLayout`, `loadWorkspaceLayoutBackup`,
  `saveWorkspaceLayout`, `removeWorkspaceLayout`, `ensureInstallation`, `saveInstallation`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`AppConfig`/`WorkspaceLayoutSnapshot` types + `DEFAULT_CONFIG`); Node
  `fs`/`os`/`path`.
- **Forbidden:** importing any sibling module or `host` — this is a leaf others depend on.
