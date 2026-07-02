---
id: submodule-spec-graph-core
type: submodule-design
status: active
title: Spec-graph core (pi-free model)
parent: module-spec-graph
tags: [spec-graph, pi-extension, v1]
---

## Responsibility

The pi-free spec model: the is-a-spec rule, frontmatter parse/serialize and in-place edit (via the
`yaml` library, with link/metadata lists inline), the derived graph (parent tree +
`depends-on`/`references`/`implements` DAG + reverse edges), the on-demand in-memory read index, content
grep with metadata filters, bounded graph slices, and structural validation. Imports **no
`@earendil-works/*`**, so it is unit-testable on its own (`core/core.test.ts`).

## Boundary

- **Owns:** everything above. The filesystem is the source of truth; the model is derived, in-memory, and
  read-only — the revalidation mechanism lives in `module-spec-graph` (*Derived read index*).
- **Public surface:** the `index.ts` **barrel**. `tools/` imports the model only through it, never a leaf
  file directly.
- **Allowed deps:** `yaml`; Node built-ins.
- **Forbidden:** any `@earendil-works/*` (this is what keeps `core/` isolated and unit-testable) and any
  `@thinkrail-pi/*` package.

## Leaves & the dependency graph

Acyclic and one-way: `parse` is the root, `graph` builds on it, and `query`/`validate`/`store` build on
`graph`. The barrel re-exports the leaves and adds no logic.

| leaf | owns | depends on |
| --- | --- | --- |
| `parse.ts` | file → `{ frontmatter, body }`; the is-a-spec rule; frontmatter parse (lossy read dialect) + serialize; the `updateFrontmatterText` lossless in-place edit; the `FIELDS` field registry and the finite-vocabulary tuples | — |
| `graph.ts` | files → nodes + edges (parent tree, DAG + reverse); duplicate-id tracking | `parse` |
| `query.ts` | content grep with metadata filters; bounded graph slices | `parse`, `graph` |
| `validate.ts` | dangling links, duplicate ids, parent cycles | `parse`, `graph` |
| `store.ts` | `SpecIndex`: the on-demand fs glob + per-file parse cache + memoized graph (the `core/index` module) | `parse`, `graph`, `query` |

## Invariants

- No `@earendil-works/*` import anywhere under `core/`.
- `buildGraph` is pure (same input → same output); the index revalidates each file by `(mtimeMs, size)`,
  memoizes the graph, and never serves a stale one.
- On a duplicate `id`, the first file seen wins the node slot; the duplicate set is recorded for `validate`.
- `SpecNode.type` stays `string`: the read model indexes whatever is on disk, so it tolerates any `type`;
  the `SPEC_TYPES` vocabulary constrains only the `spec_create` authoring surface, never the graph.
- Finite vocabularies (`SPEC_TYPES`, `SPEC_STATUSES`, `SLICE_DIRECTIONS`, `LINK_KINDS`, `IDENTITY_FIELDS`)
  and frontmatter field names (the `FIELDS` registry) are single-sourced `as const` — no duplicated literal lists, so a
  rename is a one-line change. `core/` stays typebox-free; only `tools/` wraps the tuples in `StringEnum`.
- Reads coerce frontmatter to a scalar/string-array dialect (lossy — nested maps and comments are
  dropped), which is fine for the derived model. The write path (`updateFrontmatterText`) is **lossless**:
  it mutates a live `yaml` Document in place, so untouched fields keep their order and any comments /
  nested values survive, and it writes the file back in its original line ending (LF or CRLF). Field
  order is **preserved, never re-sorted** — `FIELD_ORDER` is only the order `spec_create` builds *new*
  frontmatter in. The `\r`-strip on the fence-interior lines is what makes CRLF-authored files parse.
