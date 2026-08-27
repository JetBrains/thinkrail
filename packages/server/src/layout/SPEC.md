---
id: submodule-server-layout
type: submodule-design
status: deprecated
title: layout — legacy workspace snapshot import
parent: module-server
depends-on: [module-contracts]
tags: [layout, persistence, wire, migration]
---

## Responsibility

Read-only compatibility adapter for old versioned per-workspace layout snapshots during one frontend-local-layout migration protocol. [[submodule-web-shell-layout-state]] may read a snapshot once to seed local state. There is no host current-layout authority, replacement, revision advancement, or publication.

## Boundary

- **Owns during import compatibility only:** safe workspace-key lookup, existing-schema migration needed to return the last known snapshot, and corrupt-primary fallback to the legacy backup.
- **Public surface (`index.ts`):** legacy `readWorkspaceLayout` plus deterministic persistence/reset seams for migration tests.
- **External deps:** `@thinkrail/contracts` legacy document/snapshot types only.
- **Forbidden:** replacement/write queues; `layout.changed`; custom-preset settings; new `WorkbenchFrame`/`WorkspaceViewState`; domain resource lifetime; rendering; or surviving the following protocol cleanup.

The client calls `layout.get` only when its endpoint/surface-qualified local document records no import
attempt for that workspace. A stored version-1 document migrates in memory to version 2 with hidden empty
bottom while preserving resources and geometry; the adapter never writes the result. An unknown future schema
is not coerced and may fall back to a compatible last-known-good backup. The first available snapshot is split
client-side into frame plus workspace resources; later workspaces contribute resources only. Presence and
absence are both marked, so reconnect and old files cannot be re-adopted.

The first new protocol removes `layout.replace`, `layout.changed`, mutation ids/conflicts, publisher wiring, and snapshot writes. Its version mismatch intentionally rejects old clients rather than maintaining two current-layout authorities. The following protocol removes `layout.get`, legacy document/snapshot DTOs, this module/spec, and snapshot files.
