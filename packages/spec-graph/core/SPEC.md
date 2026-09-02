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
  file directly. The barrel binds *consumers*; the module's own test (`core/core.test.ts`) may import a
  leaf directly to reach helpers that are deliberately not public — the pure path guards, segment
  resolver, and glob order comparator in `store.ts`, which pin `resolveSpecPath` and the glob order
  without touching a filesystem.
- **Allowed deps:** `yaml`; Node built-ins.
- **Forbidden:** any `@earendil-works/*` (this is what keeps `core/` isolated and unit-testable) and any
  `@thinkrail/*` package.

## Leaves & the dependency graph

Acyclic and one-way: `parse` is the root, `graph` builds on it, and `query`/`validate`/`store` build on
`graph`. The barrel re-exports the leaves and adds no logic.

| leaf | owns | depends on |
| --- | --- | --- |
| `parse.ts` | file → `{ frontmatter, body }`; the is-a-spec rule; frontmatter parse (lossy read dialect) + serialize; the `updateFrontmatterText` lossless in-place edit; the `FIELDS` field registry and the finite-vocabulary tuples | — |
| `graph.ts` | files → nodes + edges (parent tree, DAG + reverse); duplicate-id tracking | `parse` |
| `query.ts` | content grep with metadata filters; bounded graph slices | `parse`, `graph` |
| `validate.ts` | dangling links, duplicate ids, parent cycles | `parse`, `graph` |
| `store.ts` | `SpecIndex`: the on-demand fs glob + per-file parse cache + memoized graph (the `core/index` module); the indexable-path rule (`resolveSpecPath`) | `parse`, `graph`, `query` |

## Invariants

- No `@earendil-works/*` import anywhere under `core/`.
- `buildGraph` is pure (same input → same output); the index revalidates each file by `(mtimeMs, size)`,
  memoizes the graph, and never serves a stale one.
- The glob filters each directory's entries down to the traversal candidates **first** — directories that
  are not ignored, plus `.md` files — and only then normalizes and sorts them, so a directory full of
  irrelevant entries costs the per-read scan nothing beyond the pass it discards them in.
- That order is **total**: candidates compare by their **NFC-normalized** name and tie-break on the raw
  name by code unit. So the spec order — and therefore which file wins a duplicate `id` — is the same on
  every filesystem: not whatever order `readdir` happened to return, not a different answer on a
  filesystem that hands back decomposed (NFD) names, and not `readdir`'s order again for two canonically
  equivalent spellings (precomposed `é` vs `e\u0301`), which share one NFC key and would otherwise be
  left wherever a stable sort found them.
  Directories and `.md` files stay in **one** candidate list, so a subdirectory is descended in its place
  among its sibling files rather than before or after all of them, and the spec sequence is name-ordered
  end to end. The filter-then-sort rewrite **preserves** that, it did not introduce it; the test exists
  because two separate lists are the obvious shape to reach for and would silently move the
  duplicate-`id` winner.
- On a duplicate `id`, the first file in that order wins the node slot; the duplicate set is recorded for
  `validate`.
- `resolveSpecPath` is the single answer to "could the index ever see this path?" and it answers with the
  **canonical relative path**, so a caller can never report an identity the index will not produce.
  It requires: root-relative, inside the root, `.md`, outside the ignored dirs, an existing root, and no
  symlink at any component beneath the root — checked with `lstat` per component, dangling links included,
  because the glob never descends a symlink. On Windows, colon-bearing paths are refused before
  normalization: this closes both drive-relative paths (`C:..\\outside.md`, which `isAbsolute` does not
  recognize) and NTFS alternate data streams (`file:SPEC.md`, which `readdir` cannot see). Every `..`
  segment that survives normalization is also refused, and the canonical absolute result must pass a
  final `relative(root, target)` containment check. These overlapping gates are deliberate: path syntax,
  normalization, and component-wise canonicalization must not be able to undermine each other. Portable
  `win32` arithmetic tests pin the escape on every host; the Windows CI lane also runs the package tests
  natively, including the `resolveSpecPath` and `spec_create` integrations. The symlink rule is what a
  string check and a `realpath` comparison both miss: a link is rejected whether it
  leaves the project, lands in an ignored directory, or points back at an indexed one, since in every case
  the file it creates is invisible to every other spec tool.
- `resolveSpecPath` canonicalizes each component to its **on-disk spelling** before it judges or reports
  it. A component whose bytes already match an entry of its parent directory is taken as written; a
  component that resolves on this filesystem *without* matching any entry byte-for-byte — a
  case-insensitive or Unicode-folding filesystem — becomes the one parent entry equal to it under
  `normalize("NFC").toLowerCase()`. Zero or two such entries is an **error**: it fails closed rather than
  guess an identity. Canonicalization stops at the first component that does not resolve, and the rest
  keeps the caller's spelling, because on a case-sensitive filesystem a new `Docs/` beside an existing
  `docs/` really is a new directory the glob will see. `rel` and `abs` are assembled from those canonical
  segments, never from the lexical spelling. A lexical `rel` is what let `NODE_MODULES/SPEC.md` report an
  identity the glob would never produce on a case-insensitive filesystem, where the write landed in
  `node_modules/`. The `.md` rule is judged twice, on the caller's string and again on the canonical
  `rel`, because a leaf that canonicalizes to `SPEC.MD` is a file the byte-exact glob never indexes.
  Existence is probed with `lstat`, so a dangling symlink counts as resolving and still reaches the
  symlink rejection above.
  Canonicalization reads the **parent's** listing, so every parent that exists is listed — not only the
  ones whose component exists — and a parent that exists but cannot be listed is an **error**, never an
  empty listing. That `readdir` is exactly the call the glob makes there: a directory the resolver cannot
  list is one the glob abandons, so a spec written under it would be invisible for the same reason a
  `node_modules` one is.
- **The write path over-refuses; the read path stays exact.** `resolveSpecPath` matches `IGNORED_DIRS`
  on the `normalize("NFC").toLowerCase()` fold of each component, so it refuses `NODE_MODULES/SPEC.md`
  in every spelling; the glob keeps matching the byte-exact `readdir` name. The two mistakes are not the
  same size. A resolver that refuses too much answers the caller with a reason it can act on; a glob that
  skips too much drops a directory a person really named `Build/` out of the index with no sign at all.
  Canonicalization alone did not reach the write path, because it only speaks for a component that
  already exists: on a project whose `node_modules` was not installed yet, `NODE_MODULES/SPEC.md`
  resolved, created the real `node_modules` on a case-insensitive filesystem, and handed the glob every
  dependency under it to index. Folding the glob as well bought nothing against that — an installed
  `node_modules` is lowercase on disk and the exact check already skips it — and it cost the `Build/`
  case, so the glob stays exact. What the fold does not reach at all: a spec written into `NODE_MODULES/`
  by pi's own `write` never passes through `resolveSpecPath`.
- `SpecNode.type` stays `string`: the read model indexes whatever is on disk, so it tolerates any `type`;
  the `SPEC_TYPES` vocabulary constrains only the `spec_create` authoring surface, never the graph.
- Finite vocabularies (`SPEC_TYPES`, `SPEC_STATUSES`, `SLICE_DIRECTIONS`, `LINK_KINDS`, `IDENTITY_FIELDS`)
  and frontmatter field names (the `FIELDS` registry) are single-sourced `as const` — no duplicated literal lists, so a
  rename is a one-line change. `core/` stays typebox-free; only `tools/` wraps the tuples in `StringEnum`.
- Reads coerce frontmatter to a scalar/string-array dialect (lossy — nested maps and comments are
  dropped), which is fine for the derived model. The write path (`updateFrontmatterText`) is **lossless**:
  it mutates a live `yaml` Document in place, so untouched fields keep their order and any comments /
  nested values survive. Field order is **preserved, never re-sorted** — `FIELD_ORDER` is only the order
  `spec_create` builds *new* frontmatter in. The `\r`-strip on the fence-interior lines is what makes
  CRLF-authored files parse.
- The write path rewrites **only the frontmatter block**: the body is spliced back byte-for-byte, a leading
  BOM is put back, and the line ending applied to the rewritten block is read from the frontmatter's own
  first break (LF or CRLF). Nothing is inferred from the body — a file whose prose happens to mix endings
  keeps every prose byte it had, which is what makes "`spec_update` never edits prose" true of the bytes
  and not just of the fields.
- The read paths carry the same obligation the other way: `grepSpecs` splits on `\n`, drops a trailing
  `\r` and a leading BOM before matching, so an anchored pattern behaves identically on an LF spec, a
  CRLF spec, and a BOM-prefixed one — the BOM would otherwise hide line 1 from every `^` pattern.
