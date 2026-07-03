---
id: submodule-server-spec
type: submodule-design
status: active
title: spec — worktree spec-graph reads
parent: module-server
depends-on: [module-contracts]
references: [module-spec-graph]
tags: [v1, spec-viewer]
---

## Responsibility

Serve the read-only Specs viewer: a whole-graph snapshot of the active worktree's spec-graph
(`spec.graph`), mapped to the wire DTOs. Read-on-demand — every call re-reads through the derived index
(revalidate-on-read), so specs edited by the agent, the editor, or git are current on the next fetch; no
file-watch push.

The read is **synchronous** (core's walk is sync-fs, O(worktree dirs) per call). That's acceptable —
fetches are on-demand (tab-visit / Refresh, no polling) and the per-file parse cache skips re-reads. If
the walk ever dominates, the escalation is core's **watcher-as-dirty-flag** (see `pi-spec-graph`
core/SPEC.md), not an async wrapper — that would still block the loop in one piece.

## Boundary

- **Owns:** `specGraph(workspaceId) → SpecGraphSnapshot` — reads the workspace's worktree through a
  per-workspace `SpecIndex` (reused across calls so the parse cache pays off — same pattern as the
  agent tools) and maps core's `SpecNode`s to the `contracts` DTOs (the field set lives there; `title`
  falls back to `id` so the wire never carries an untitled node). **Mapping only** — no traversal
  logic; the client builds the tree. `evictSpecIndex(workspaceId)` — drops the cached index; `host`
  calls it on `workspace.remove` so an archived workspace's parse cache doesn't outlive it (a later
  read would just rebuild).
- **Public surface (barrel):** `specGraph`, `evictSpecIndex`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (DTOs); **`pi-spec-graph/core`** (the
  pi-free read model — the one host-side value-import of the extension package, sanctioned in
  `module-spec-graph`).
- **Forbidden:** `host`; sibling features; `pi-spec-graph`'s extension entry or `tools/` (pi-coupled);
  any pi package.
