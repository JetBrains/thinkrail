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

Durable host state—projects, workspaces, cross-frontend app config, terminal catalogs, and installation identity—as JSON under the data dir. Current workbench frame and workspace placement are frontend-local and have no steady-state host persistence.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`);
  project/workspace/config load-save operations; fieldwise config normalization over `DEFAULT_CONFIG` while
  preserving unknown top-level extension fields; and `ensureInstallation` / `saveInstallation` over
  `installation.json` (`{ id, announced }`, the non-rotating per-install uuid4 plus `app_installed`-sent bit,
  server-only and never wire-broadcast). JSON remains tab-indented.
- **Public surface (barrel):** `dataDir`, project/workspace/config load-save operations, and installation identity operations. During the compatibility protocol it also exposes legacy workspace-layout primary/backup reads and workspace-removal cleanup to [[submodule-server-layout]]; those disappear with that module in the following protocol.
- **Allowed deps:** `contracts` (`Project`, `Workspace`, `AppConfig`, `LayoutPreset`, `DEFAULT_CONFIG`); Node `fs`/`os`/`path`.
- **Forbidden:** importing feature siblings or `host`; persisting a new current frame/view, selection/focus, or frontend-surface identity.

Config normalization accepts only a bounded custom layout-preset catalog as synchronized layout data. Current/default preset ids and group limits are not config fields and cannot be reconstructed here.

Legacy full snapshots remain read-only traversal-safe workspace-keyed primary/backup files solely for import. The new client reads each workspace at most once through the compatibility endpoint; no host path writes or revisions them. Workspace removal may delete its obsolete files. The next protocol removes the endpoint and all remaining files rather than treating them as fallback authority.
