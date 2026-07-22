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

Durable app state — projects, workspaces, the server-synced app config, and the `workspaces/hooks`
submodule's host-local hook overrides/approvals — as JSON under the data dir.

## Boundary

- **Owns:** `dataDir()` (`THINKRAIL_DATA_DIR` for dev/e2e isolation, else `~/.thinkrail`);
  `loadProjects`/`saveProjects`, `loadWorkspaces`/`saveWorkspaces`, `loadConfig`/`saveConfig`
  (`config.json`, merged over `DEFAULT_CONFIG` so a missing file or key degrades cleanly), and
  `loadHookOverrides`/`saveHookOverrides` (`hookOverrides.json` — a per-project, host-local hook-command
  override, keyed by `HookName`, that replaces rather than merges with the committed
  `.thinkrail/hooks.json` value) + `loadHookApprovals`/`saveHookApprovals` (`hookApprovals.json` —
  `Record<string, Partial<Record<HookName, { shared?: string; local?: string }>>>`: per-project, per-hook,
  a sha256 of the approved material for *each* `HookSource` independently — Shared and Local approve
  separately since `combineMode: "both"` can run both for the same event; read/written by
  `workspaces/hooks`'s approval gate) — all tab-indented JSON.
- **Public surface (barrel):** `dataDir`, `loadProjects`, `saveProjects`, `loadWorkspaces`,
  `saveWorkspaces`, `loadConfig`, `saveConfig`, `loadHookOverrides`, `saveHookOverrides`,
  `loadHookApprovals`, `saveHookApprovals`.
- **Allowed deps:** `contracts` (`Project`/`Workspace`/`AppConfig`/`HookName` types + `DEFAULT_CONFIG`);
  Node `fs`/`os`/`path`.
- **Forbidden:** importing any sibling module or `host` — this is a leaf others depend on.
