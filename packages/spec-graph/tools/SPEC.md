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

The eight `pi` custom tools that expose the spec model to the agent — `spec_search`, `spec_grep`,
`spec_get`, `spec_graph`, `spec_create`, `spec_update`, `spec_delete`, `spec_validate`. Each is a **thin wrapper** over
`core/`: parse the typebox params, call a `core/` function, format a text result + structured `details`.
None edit prose.

## Boundary

- **Owns:** tool registration, param schemas, and result formatting; the per-root `SpecIndex` cache,
  the bounded per-root section-index cache and the `spec_create` scaffold headings (`shared.ts`).
- **Public surface:** the `index.ts` **barrel** exporting `registerSpecTools(pi)`; the extension entry
  (`../index.ts`) is the only caller.
- **Allowed deps:** `core/` (via its barrel), `@earendil-works/pi-coding-agent` (types and public
  truncation helpers), `@earendil-works/pi-ai` (`StringEnum`, from the package root), `typebox`, Node
  built-ins. Project writes remain confined to write tools; any tool may capture oversized responses
  in private OS temporary files, never in the project.
- **Forbidden:** reaching into `core/` leaf files (import only the barrel); any `@thinkrail/*` package.

## Leaves

One leaf per tool (`grep.ts` → `spec_grep`, and so on), each wrapping the corresponding `core/` function
and depending on `shared.ts` (the index cache + result/scaffold helpers), which depends on `core/`. Leaves
don't depend on each other; `index.ts` composes them. `spec_create`/`spec_update`/`spec_delete` write the
file; the other five are read-only.

## Invariants

- Model-facing text, notices included, stays within Pi's 2,000-line / 50 KiB limits. Overflow is
  captured in a private temporary file, which may expire; capture failure is explicit and never fails
  a completed mutation. Tool errors set `isError: true` and retain a visible error marker even if
  capture fails. Structured `details` remain presentation data, outside model context.
- `spec_grep` pages by zero-based match offset with both a count and formatted-byte ceiling. Follow
  `nextOffset` with the same filters; offset reads the current sorted sources, not a snapshot, so
  restart when files change. One oversized match is file-backed rather than skipped or split.
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
- The spec root is `ctx.cwd`; one `SpecIndex` is reused per root (freshness handled in `core/` — see
  `module-spec-graph`). `spec_update` reads via `recordForId` to reuse the scan's cached read; write tools
  just write, and the next read picks the change up.
- `spec_search` re-syncs its root's section index from the `SpecIndex` read on every call
  (`indexSections` re-tokenizes only changed files), so the agent's own edits rank on its next search.
  Section indexes are the costly cache (several MB per large root), so `shared.ts` keeps the
  `MAX_SECTION_INDEX_ROOTS` most recently searched roots and drops the oldest. The result is one
  `path:line  Spec › Section — snippet` line per hit, best first, with `(n/m words)` on a partial
  match, and no section bodies — the agent reads at the line. `limit` defaults to 8 and is clamped at
  25; `type`/`tag`/`parent` narrow like `spec_grep`.
