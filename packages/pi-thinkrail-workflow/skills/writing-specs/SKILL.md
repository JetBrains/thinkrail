---
name: writing-specs
description: "Use when a workflow step drafts or revises a spec artifact — a goal-and-requirements, an architecture, or a module SPEC — or when a workflow skill names it at such a step. The shared quality bar for specs — not a workflow, nothing to execute."
---

# Writing Specs

The workflow family's shared bar for every spec a workflow produces: **short, honest, on-rails, shaped**.
Process skills name this concept at the steps that draft or revise specs; *what* to draft and *when*
stays with the referencing skill. Graph mechanics — frontmatter, link kinds, the `spec_*` tools — are
the spec-graph skill's ground; this concept carries the quality bar the family holds on top of them,
and is where the family's rules for specs and the spec graph accrue.

## Short

- Small enough to read in one sitting. Target signal, not completeness.
- Explain intent, not inventory: what the thing is for, what it owns, where its boundary runs — never
  a file listing or a restatement of the code.
- **Budgets** (`spec_validate` and `check:spec-lint` measure them): ≤ 400 lines, ≤ 4,000 words, a
  heading at least every 60 lines, no list item over 8 lines, no table cell over 200 characters, file
  under 50 KB (the size a reader loads in one call). Over budget is a signal to split, not to compress.
- **Split by owner, not by size.** A spec over budget gains a child spec beside the sub-directory that
  owns the topic (`panels/review/SPEC.md`, `parent:` the module), linked by id; the parent keeps one
  paragraph per child. Never a second spec for the same directory.

## Honest

- Only settled content appears. Never pad with `[TBD]` or placeholder sections — a section that
  hasn't been settled simply doesn't exist yet, so a scaffolded heading you don't fill is deleted.
- Anything inferred rather than confirmed is marked unconfirmed, inline, where it stands.
- New and inferred specs are `status: draft` until the user has reviewed them — the flip out of
  `draft` follows the user's review, never the drafting agent's own judgment. A reviewed durable spec
  goes `active`, never `done`: it stays in force and evolves with the project.

## On-rails

- High-signal enough that a future agent (or human) lands on the decisions without re-deriving them.
- The spec is the *only* home for rationale: decisions, invariants, trade-offs, and bug post-mortems
  are recorded here, never as code comments — a rationale paragraph found in code is content to
  promote into the owning spec, leaving at most a one-line pointer where misediting would silently
  break something.
- Say each thing once: link by `id` instead of restating; the dependency edges *between* sibling
  modules live in the parent's spec, not in each leaf.
- One spec per *genuine* boundary — not per directory, not per file.
- **A post-mortem is one invariant plus one history line.** The rule it produced goes into
  `## Invariants` as a checkable one-liner; the story (date · symptom · cause) goes into `## History`
  pointing at that invariant. Narrative never lands inside `## Behavior`.
- **Subtract when you add.** Every addition names the prose it supersedes and removes or merges it. A
  spec edit that only inserts is a smell; the ratchet (`check:spec-lint`) only ever lets a spec move
  toward the budgets.

## Shaped

A module or submodule spec has six `##` sections, in this order. `spec_create` scaffolds them; delete
any you leave empty. Only the first two are mandatory.

| section | holds | form |
|---|---|---|
| `Responsibility` | what it is for, what it owns | one paragraph |
| `Boundary` | public surface, allowed deps, forbidden reaches | short bullet lists |
| `Behavior` | what the caller or user observes | one `###` per topic, ≤ ~20 lines each |
| `Invariants` | rules that must hold | numbered one-liners: "never", "always", "exactly one" |
| `Decisions` | choices that could have gone another way | one `###` per decision (YYYY-MM): context → choice → rejected alternatives |
| `History` | post-mortems | one line each: YYYY-MM · symptom · cause → Invariant #n |

The sections separate the *kinds* of content a reader skims for: a contract is not a description, a
rationale is not a rule, and a bug story is neither. Anything that used to live under an ad-hoc heading
("Get right", "Sub-modules", "Streaming model") goes under one of the six as a `###`.

Style, per sentence:

- One idea per bullet. A bullet that needs a second paragraph is a `###` topic.
- Bold only for a label (`**Owns:**`) or a term's first definition; never for emphasis. No ALL-CAPS
  emphasis. No parenthetical inside a parenthetical.
- No CSS classes, `data-testid`s, or source-file paths as spec content; point at the test that pins
  the behavior instead. Internal identifiers belong in `Boundary`, if anywhere.
- Prefer "X does Y" to "X does Y (because Z, which once broke W — see …)": the *because* goes to
  `Decisions`, the *once broke* to `History`.

## The goal doc describes the product, not a plan

`goal-and-requirements` is the living record of what the product is and why: its goal, problem,
audience, capabilities, and non-goals, plus any durable principles.

- No versions, releases, phases, MVP/v1/v2 splits, or "later" lists. Sequencing is not a spec's job:
  an idea cut from scope goes back to the user to track wherever they plan work, and never into the doc.
- **Capabilities** state what the product does, or for a new project what its smallest useful first
  build will do.
- **Non-goals** hold only what is excluded by decision. Something neither listed nor excluded is open,
  not forbidden.
- It evolves with the product: a change that adds a capability or overturns a principle updates the goal
  doc in the same change.
