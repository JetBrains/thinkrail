---
name: writing-specs
description: "Use when a workflow step drafts or revises a spec artifact — a goal-and-requirements, an architecture, or a module SPEC — or when a workflow skill names it at such a step. The shared quality bar for specs — not a workflow, nothing to execute."
---

# Writing Specs

The workflow family's shared bar for every spec a workflow produces: **short, honest, on-rails**.
Process skills name this concept at the steps that draft or revise specs; *what* to draft and *when*
stays with the referencing skill. Graph mechanics — frontmatter, link kinds, the `spec_*` tools — are
the spec-graph skill's ground; this concept carries the quality bar the family holds on top of them,
and is where the family's rules for specs and the spec graph accrue.

## Short

- Small enough to read in one sitting. Target signal, not completeness.
- Explain intent, not inventory: what the thing is for, what it owns, where its boundary runs — never
  a file listing or a restatement of the code.

## Honest

- Only settled content appears. Never pad with `[TBD]` or placeholder sections — a section that
  hasn't been settled simply doesn't exist yet.
- Anything inferred rather than confirmed is marked unconfirmed, inline, where it stands.
- New and inferred specs are `status: draft` until the user has reviewed them — the flip out of
  `draft` follows the user's review, never the drafting agent's own judgment.

## On-rails

- High-signal enough that a future agent (or human) lands on the decisions without re-deriving them.
- Say each thing once: link by `id` instead of restating; the dependency edges *between* sibling
  modules live in the parent's spec, not in each leaf.
- One spec per *genuine* boundary — not per directory, not per file.
