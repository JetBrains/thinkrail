---
name: spec-graph
description: "Use when locating, reading, creating, updating, or validating project specs, or when work is governed by or may alter a documented boundary, contract, invariant, behavior, or architecture decision."
---

# Spec graph

## Specs are the ground truth

- Specs describe the architecture, decisions, contracts, and boundaries behind the code — the intent
  that the code alone does not reveal. Treat them as authoritative.
- **Consult the owning spec when it governs the work.** When work depends on, checks, explains, or
  may alter a documented boundary, contract, invariant, behavior, or architecture decision, use
  `spec_grep` / `spec_get` / `spec_graph` to find the applicable record and align with it. If a change contradicts a recorded
  decision, surface and reconcile the contradiction rather than silently diverging.
- **Keep lookup proportional.** Specs are the map for decisions and boundaries; code confirms the
  implementation. A localized fix, explanation, or check that changes no documented decision may
  inspect only the files it needs without reading unrelated specs.
- **Keep them honest.** A change that moves or blurs a boundary, or overturns a decision, updates the
  spec as part of the same change. Specs that drift from the code stop being ground truth.

## What a spec is

- A durable, declarative document. It states the world as it is — the intent, decisions, contracts, and
  boundaries behind the code — not plans, tasks, phases, or a work journey.
- Concise and readable. It captures what is *not* obvious from the code; it never restates the code.
- The bar: reading the relevant specs should be enough to understand an area and to formulate a task to
  improve it.

### Keep specs lean

- **Explain intent, not inventory.** Describe what a module is for, what it owns, and where its boundaries
  are — not a file-by-file transcript of its directory. The reader can see the files; the spec exists for
  what the files *don't* say.
- **Record the edges that matter.** State the module's boundary (allowed / forbidden deps) and the
  dependency edges between its sub-modules. List a part only when its role or its edges aren't obvious from
  its name — e.g. a small table that carries a real dependency DAG earns its place; a table that just
  pairs `foo.ts` with "the foo tool" is noise, so say it in a sentence instead.
- **Say each thing once.** A fact lives in exactly one spec; others link to it by `id` rather than restate
  it. If a paragraph is being copied between specs, move it to the spec that owns the concept and point at
  it. Duplicated prose drifts and turns into contradictions.
- **Prefer prose to exhaustive tables**, and cut anything that only paraphrases code, filenames, or a
  sibling spec.

## The graph

- `parent` links form a hierarchy that mirrors the code structure: a `SPEC.md` sits beside the module it
  describes (fractal — a package and its sub-directories each have one), and root documents sit at the
  repository root.
- `depends-on`, `references`, and `implements` form a dependency layer across the tree.

## Frontmatter

- Required: `id` (a unique slug), `type`, `title`.
- Optional: `status` (lifecycle), `parent` (single link), `depends-on` / `references` / `implements`
  (link lists), `covers`, `tags`.
- A file is a spec when its frontmatter carries `id` and `type`.
- `status` tracks a spec's lifecycle: `draft` (being written) → `active` (in force), then `stale` (drifting
  from the code), `done`, or `deprecated`. It's optional, but keep it current as a spec firms up or ages.
- Types:
  - `goal-and-requirements` — the product goal and scope; the root of the graph.
  - `architecture-design` — system-wide topology, cross-cutting decisions, and invariants.
  - `module-design` — a package or module's responsibility and boundary.
  - `submodule-design` — the same, for a directory-level module inside a package.
  - `task-spec` — a temporary working document for a piece of work; not durable, and removed once the
    work lands.

## Tools

Read:
- `spec_grep` — search within specs (content, narrowed by metadata filters).
- `spec_get` — a spec's frontmatter, its resolved links, and its path. Read the body with the normal
  `read` tool using that path.
- `spec_graph` — a bounded slice of the graph: a subtree, ancestors, or a node's neighbors, to a depth.

Manage:
- `spec_create` — a new spec with scaffolded frontmatter and headings.
- `spec_update` — a spec's frontmatter (fields and links). It does not touch the body.
- `spec_delete` — remove a spec.
- `spec_validate` — report dangling links, duplicate ids, and parent cycles.

Prose is written and edited with the normal `write`/`edit` tools; the spec tools own frontmatter and
structure.

## Working with specs

1. **Orient when specs govern the work.** From a known root or the module you are touching, use
   `spec_graph` for the neighborhood, `spec_get` for a node's metadata, and `read` for its body. Use
   `spec_grep` to find specs by content.
2. **Align.** Reconcile the change with the decisions and contracts the specs record; surface
   contradictions before diverging.
3. **Update.** When the change alters a boundary, contract, or decision, update the spec — frontmatter
   (including `status`) with `spec_update`, prose with `edit` — and add `spec_create` for a new module.
4. **Check.** Run `spec_validate` after structural changes.
