---
id: submodule-server-layout
type: submodule-design
status: active
title: layout — synchronized workspace layout snapshots
parent: module-server
depends-on: [module-contracts]
tags: [layout, persistence, wire]
---

## Responsibility

The host authority for one versioned structural workbench-layout snapshot per workspace: validate and migrate
the recursive center plus left/right/bottom auxiliary regions, atomically persist, monotonically revision,
replace, and broadcast complete documents.

## Boundary

- **Owns:** structural validation and safety bounds; per-workspace accepted document + revision; known-schema
  migration; last-known-good recovery; a per-workspace serial queue that makes request arrival,
  expected-revision comparison, persistence, and revision order identical; the layout read/replace handlers;
  and publisher injection for
  the full-snapshot `layout.changed` channel, including the request's origin mutation id (correlation
  metadata only, never persisted in the document).
- **Public surface (`index.ts`):** read/replace operations, document + portable-preset validators, pure
  persisted-layout-settings normalization, publisher injection, persistence/recovery hooks, and a test
  reset seam. `host`
  supplies the current independent side/bottom group-limit policy from `settings`; layout does not import that
  sibling.
- **External deps:** `@thinkrail/contracts` only. Internal sibling edges are declared in the server parent
  spec.
- **Forbidden:** importing host or web; rendering/layout projection; owning file/session/terminal lifetime;
  storing active tab or focus; becoming a second semantic mutation engine; command merge/rebase; accepting
  malformed/unknown-schema documents.

`layout.get` returns `null` for an uninitialized workspace; the compatible web client owns built-in preset
instantiation and commits the first document through the normal replace path. A persisted version-1 document
migrates to version 2 with a hidden, empty below-center bottom region, preserving every existing placement,
side geometry, and process lifetime. Migration floors the reported snapshot revision at 2. Revision 1
identifies a first persisted version-2 document, not whether its workspace is new; the web combines it with
`Workspace.initialTerminalEligible`, which is owned by the workspace registry, for one-time default-terminal
seeding. A bottom-less custom preset normalizes the same way. An unknown future
version is preserved and may fall back to a compatible last-known-good copy, but an older host never
overwrites it implicitly. Persisted settings normalization isolates malformed custom presets and, when the
selected custom preset is lost, restores the contracts default preset **and both default group capacities** so
the fallback cannot become structurally inapplicable.

A replacement is accepted only when `expectedRevision` matches the current snapshot inside the serialized
workspace queue: `null` matches absence only, and a number matches that exact revision only. A mismatch
returns a typed conflict carrying the current snapshot (including `null`) and does not validate/persist the
stale document, increment the revision, or broadcast. `mutationId` remains correlation metadata only.
Configured limits use `max(limit, acceptedCount)`: one shared left/right limit plus an independent bottom
limit, so grandfathered overages survive but cannot increase. On acceptance the module assigns the next
revision, persists before broadcasting, and cancels queued writes when workspace cleanup wins the race. It
enforces one final empty center leaf; normalized split, side, and bottom weights; outer side widths that leave
a center region; bottom height within its normalized contract; a closed alignment enum; non-empty side groups
versus intentionally legal empty bottom slots; canonical worktree-relative POSIX file/diff/document paths
(backslashes, absolute paths, and Windows drive-absolute forms are rejected); opaque placement ids (including
singleton-tool ids); and one semantic placement per resource. It never mutates a document merely because a
client viewport is smaller. Resource validation is syntactic and policy-based;
layout does not dereference sibling domain registries. References are placement only, and
their domain modules remain the existence/lifetime authorities.
