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
(`spec.graph`) — nodes plus the registered *type cards* (`SpecTypeInfo`, via `SpecTypeRegistry`) —
mapped to the wire DTOs. Read-on-demand — every call re-reads through the derived index and registry
(revalidate-on-read), so specs and type cards edited by the agent, the editor, or git are current on
the next fetch.
(The sibling `watch` module separately nudges clients to re-fetch — an invalidation push, not a data
push; this module's read path stays pull-only.) Also answers the project-level **`projectHasSpecs(root)`** — does a repo carry *any
durable* spec (any node whose type's card resolves to `lifecycle: durable`; unknown types count as
durable) — which `host` exposes via the **lazy `project.hasSpecs`** method (a full-tree walk, so
requested only for the one project the Welcome screen renders, never eagerly for every project).

The read is **synchronous** (core's walk is sync-fs, O(worktree dirs) per call). That's acceptable —
fetches are on-demand (tab-visit / Refresh / a `workspace.fsChanged` nudge, no polling) and the
per-file parse cache skips re-reads. If
the walk ever dominates, the escalation is core's **watcher-as-dirty-flag** (see `pi-spec-graph`
core/SPEC.md), not an async wrapper — that would still block the loop in one piece.

## Boundary

- **Owns:** `specGraph(workspaceId) → SpecGraphSnapshot` — reads the workspace's worktree through a
  per-workspace `SpecIndex` + `SpecTypeRegistry` (reused across calls so the caches pay off — same
  pattern as the agent tools) and maps core's `SpecNode`s and resolved type cards to the `contracts`
  DTOs (the field set lives there; `title` falls back to `id` so the wire never carries an untitled
  node; a project card's path is mapped worktree-relative). **Mapping only** — no traversal
  logic; the client builds the tree. `evictSpecIndex(workspaceId)` — drops the cached index + registry; `host`
  calls it on `workspace.remove` so an archived workspace's parse cache doesn't outlive it (a later
  read would just rebuild). **`projectHasSpecs(root) → boolean`** — whether a repo **root** (not a
  worktree) carries any **durable** spec (any node whose type's card is `lifecycle: durable`; unknown
  types count durable — an ephemeral scratch task-spec, e.g. under `.thinkrail/context/`, must never
  signal "set up"), through a per-root reused `SpecIndex` + registry; the
  project-level signal behind the Welcome screen's "Set up project" suggestion. Degrades to `false` on a
  glob/parse failure so it can never break `project.open` / `project.list`.
- **Public surface (barrel):** `specGraph`, `evictSpecIndex`, `projectHasSpecs`.
- **Allowed deps:** `persistence` (workspace lookup); `contracts` (DTOs); **`pi-spec-graph/core`** (the
  pi-free read model — the one host-side value-import of the extension package, sanctioned in
  `module-spec-graph`).
- **Forbidden:** `host`; sibling features; `pi-spec-graph`'s extension entry or `tools/` (pi-coupled);
  any pi package.
