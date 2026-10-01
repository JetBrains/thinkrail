---
id: submodule-spec-graph-tools
type: submodule-design
status: active
title: Spec-graph tools (pi wrappers)
parent: module-spec-graph
depends-on: [submodule-spec-graph-core]
tags: [spec-graph, pi-extension]
---

## Responsibility

The seven `pi` custom tools that expose the spec model to the agent — `spec_grep`, `spec_get`,
`spec_graph`, `spec_create`, `spec_update`, `spec_delete`, `spec_validate`. Each is a **thin wrapper** over
`core/`: parse the typebox params, call a `core/` function, format a text result + structured `details`.
None edit prose.

## Boundary

- **Owns:** tool registration, param schemas, and result formatting; the per-root `SpecIndex` cache, the
  `spec_create` scaffold headings, and the module-scaffold guide text (`shared.ts`).
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
- `spec_create` writes only what the index can later read back, and it checks that in three places: the
  target path goes through `core`'s `resolveSpecPath` (which also yields the canonical relative path the
  tool reports, so its `Created <path>` never disagrees with what `spec_get` will say), the assembled
  bytes must parse back as a spec before anything is written, and the write itself is exclusive
  (`flag: "wx"`) so the existence check cannot be raced or satisfied by a link.
- `spec_create` scaffolds module and submodule specs with `core`'s `MODULE_SECTIONS` — all six headings,
  heading-only, never a placeholder sentence — and its result text tells the author what each section
  holds and to delete any left empty. The scaffold is the write half of a loop `spec_validate` closes: a
  fresh, unfilled scaffold reports six `empty-section` warnings until it is filled or trimmed.
- `spec_validate` separates **errors** (dangling links, duplicate ids, parent cycles — the graph is
  invalid) from **structure warnings** (`core`'s `lintSpecs` over every spec, or over one when `id` is
  passed). Warnings never make the graph invalid; the text lists at most 40 findings with a per-rule
  summary and a count of the rest, so a large repo's report stays readable in a tool result. `details`
  carries the full `ValidationReport` plus `lint`.
- The spec root is `ctx.cwd`; one `SpecIndex` is reused per root (freshness handled in `core/` — see
  `module-spec-graph`). `spec_update` reads via `recordForId` to reuse the scan's cached read; write tools
  just write, and the next read picks the change up.
