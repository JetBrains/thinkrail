---
id: submodule-spec-graph-tools
type: submodule-design
status: active
title: Spec-graph tools (pi wrappers)
parent: module-spec-graph
depends-on: [submodule-spec-graph-core]
tags: [spec-graph, pi-extension, v1]
---

## Responsibility

The seven `pi` custom tools that expose the spec model to the agent — `spec_grep`, `spec_get`,
`spec_graph`, `spec_create`, `spec_update`, `spec_delete`, `spec_validate`. Each is a **thin wrapper** over
`core/`: parse the typebox params, call a `core/` function, format a text result + structured `details`.
None edit prose.

## Boundary

- **Owns:** tool registration, param schemas, and result formatting; the per-root `SpecIndex` cache and the
  `spec_create` scaffold headings (`shared.ts`).
- **Public surface:** the `index.ts` **barrel** exporting `registerSpecTools(pi)`; the extension entry
  (`../index.ts`) is the only caller.
- **Allowed deps:** `core/` (via its barrel), `@earendil-works/pi-coding-agent` (types + `registerTool`),
  `@earendil-works/pi-ai/compat` (`StringEnum`), `typebox`, Node built-ins (`node:fs`/`node:path`, write
  tools only).
- **Forbidden:** reaching into `core/` leaf files (import only the barrel); any `@thinkrail/*` package.

## Leaves

One leaf per tool (`grep.ts` → `spec_grep`, and so on), each wrapping the corresponding `core/` function
and depending on `shared.ts` (the index cache + result/scaffold helpers), which depends on `core/`. Leaves
don't depend on each other; `index.ts` composes them. `spec_create`/`spec_update`/`spec_delete` write the
file; the other four are read-only.

## Invariants

- Tools never edit prose; `spec_update` is frontmatter-only and never un-specs a file — it won't remove or
  blank `id`/`type`, and won't rename `id`. It sets/removes scalar fields and adds/removes entries across
  every list field (`depends-on`/`references`/`implements` + `covers`/`tags`) via `addList`/`removeList`;
  `set` refuses a list field (it would list-coerce a scalar into one wrong entry). The edit is applied in
  place by `core`'s `updateFrontmatterText`, so comments, nested/unknown fields, field order, and the
  file's line endings are preserved.
- Frontmatter field keys the tools read/write come from `core`'s `FIELDS` registry, and params over a
  finite vocabulary use `StringEnum` seeded by the `core/` tuple (`spec_create.type` ← `SPEC_TYPES`,
  `spec_create.status` ← `SPEC_STATUSES`, `spec_graph.direction` ← `SLICE_DIRECTIONS`,
  `spec_graph.edge` ← `LINK_KINDS`) — never re-typed literals, so a `core` rename flows here with no edit
  (pinned by `tools/tools.test.ts`).
- The spec root is `ctx.cwd`; one `SpecIndex` is reused per root (freshness handled in `core/` — see
  `module-spec-graph`). `spec_update` reads via `recordForId` to reuse the scan's cached read; write tools
  just write, and the next read picks the change up.
