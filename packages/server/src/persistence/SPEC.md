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

Durable app state — projects and workspaces — as JSON under the data dir.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`);
  `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces` (tab-indented JSON).
- **Public surface (barrel):** `dataDir`, `loadProjects`, `saveProjects`, `loadWorkspaces`, `saveWorkspaces`.
- **Allowed deps:** `contracts` (`Project`/`Workspace` types); Node `fs`/`os`/`path`.
- **Forbidden:** importing any sibling module or `host` — this is a leaf others depend on.
