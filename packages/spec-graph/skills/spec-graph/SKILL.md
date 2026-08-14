---
name: spec-graph
description: "The project's specs are its ground truth: durable documents describing the architecture, decisions, contracts, and boundaries behind the code, organized as a connected graph. Read this skill and reach for the spec tools FIRST — before reading code — whenever you explore the project, plan or start a task, add or change a feature, implement anything, investigate an area, check work against recorded decisions and contracts, or otherwise work with specs. Also use it to create or maintain specs."
---

# Spec graph

## Specs are the ground truth

- Specs describe the architecture, decisions, contracts, and boundaries behind the code — the intent
  that the code alone does not reveal. Treat them as authoritative.
- **Reach for the spec tools first.** Whenever you set out to explore the project, plan a change,
  investigate an area, or work with specs in any way, your *first* move is the spec tools
  (`spec_grep` / `spec_get` / `spec_graph`) — before `grep`, `find`, or reading source. The specs are
  the map; the code is the territory you confirm against it.
- **Start from the specs, not the code.** To understand an area or plan a change, read the relevant
  specs first and use them as the map; read code second, to confirm details.
- **Check work against them.** Before introducing a decision, a contract, or a boundary change, find
  what the specs already say and align with it. If a change contradicts a recorded decision, surface the
  contradiction and reconcile it — update the spec or change the approach — rather than silently
  diverging.
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
  A type card may narrow the vocabulary for its own type (e.g. `decision`: proposed → accepted →
  superseded).

## Spec types (type cards)

A spec's `type` names a **type card** — one markdown file defining what that kind of spec is for,
when to choose it, and what it should contain. Types are not a fixed list: they resolve through a
registry — the project's **`.pi/spec-types/*.md`** (committed, the team's shared vocabulary) wins
over the built-ins on a name clash.

- **Run `spec_types` to see what's registered**; every card carries a description that says when to
  choose it.
- **Read the card before authoring a spec of its type** (`spec_types` with `name`) — the same norm as
  reading a skill before its task. The card's body carries the when-to-use and the quality bar;
  `spec_create` scaffolds the body from the card.
- Every type declares a **lifecycle**: `durable` specs are the ground truth — contracts, decisions,
  boundaries, kept honest as code changes. `ephemeral` specs serve one piece of work and end by
  **promotion**: their settled decisions fold into the durable specs that own them, then they retire.
  Durable specs win on any conflict. An ephemeral spec's *location* is a default, never a rule —
  keeping one in-repo doesn't make it authoritative.
- A type card **refines the global rules for one type; it never overrides them** — the boundary,
  say-once, and lean-spec rules above hold for every spec regardless of type.
- Defining a new type = dropping a card in `.pi/spec-types/`: frontmatter `name` + `description`
  (required), plus optional `lifecycle` (default `durable`), `home` (location hint), `sections`
  (expected headings — also the scaffold), `fields`, `statuses`, `links` (expectations over the
  built-in link kinds); body = when to use, quality bar, and an optional `## Template` block that
  scaffolding prefers over `sections`.

The built-ins: `goal-and-requirements` (the root: product goal and scope), `architecture-design`
(system-wide decisions and invariants), `module-design` / `submodule-design` (a module's
responsibility and boundary, fractal), `task-spec` (ephemeral working doc for one piece of work),
`charter` (the project's declared stance on specs — how authoritative, what agents read first),
`decision` (an ADR: one hard-to-reverse decision, append-only history).

## Tools

Read:
- `spec_grep` — search within specs (content, narrowed by metadata filters).
- `spec_get` — a spec's frontmatter, its resolved links, and its path. Read the body with the normal
  `read` tool using that path.
- `spec_graph` — a bounded slice of the graph: a subtree, ancestors, or a node's neighbors, to a depth.
- `spec_types` — the registered spec types, or one type card in full (read it before authoring).

Manage:
- `spec_create` — a new spec with scaffolded frontmatter and headings.
- `spec_update` — a spec's frontmatter (fields and links). It does not touch the body.
- `spec_delete` — remove a spec.
- `spec_validate` — report dangling links, duplicate ids, and parent cycles.

Prose is written and edited with the normal `write`/`edit` tools; the spec tools own frontmatter and
structure.

## Working with specs

1. **Orient.** From a known root or the module you are touching, use `spec_graph` for the neighborhood,
   `spec_get` for a node's metadata, and `read` for its body. Use `spec_grep` to find specs by content.
2. **Align.** Reconcile the change with the decisions and contracts the specs record; surface
   contradictions before diverging.
3. **Update.** When the change alters a boundary, contract, or decision, update the spec — frontmatter
   (including `status`) with `spec_update`, prose with `edit` — and add `spec_create` for a new module.
4. **Check.** Run `spec_validate` after structural changes.
