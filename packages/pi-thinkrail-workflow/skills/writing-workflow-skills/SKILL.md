---
name: writing-workflow-skills
description: "Use when adding a new workflow skill to pi-thinkrail-workflow, changing an existing workflow skill's role, trigger, handoff, or structure, or checking a workflow skill against the workflow system's rules. Not for authoring general-purpose skills outside this package."
---

# Writing Workflow Skills

The authoring checklist for workflow skills in `packages/pi-thinkrail-workflow`. It carries the *what
to do*; every *why* — the concept model, the three roles, the meta-rules cited as "(rule N)" below —
lives once in the workflow-system spec beside this directory, **`skills/SPEC.md`**. Read that spec
first; where this checklist and that spec disagree, the spec wins.

**Workspace guard.** This checklist edits `packages/pi-thinkrail-workflow` in the thinkrail repo. If
that package is not in the current workspace (a ThinkRail-managed project, where these skills are a
read-only staged cache), the family cannot be extended from here: say so in one line and stop — the
terminal state for foreign workspaces.

## Design (before writing)

- [ ] Read `skills/SPEC.md`: concept model, the three roles, meta-rules 1–15.
- [ ] Scope the skill to one externally reachable workflow — or, for a concept, one topic (rule 1).
      Internal forks, branches, stages, and shared tails are sibling docs, planned with the choice
      rules in the doc (or spine) before the fork; a doc is promoted to its own skill when it needs
      independent addressability (an external caller, a genuine self-trigger, or a direct entry point
      such as a `/skill:` command seed) — never for shape or size alone.
- [ ] Pick the role (rule 2): **router** (classification rules + handoffs, nothing else), **worker**
      (one phase's steps), or **concept** (one topic's reusable rules/mental model — no steps, no
      handoffs).
- [ ] For a concept: confirm a second skill needs it (rule 3) — reference detail with a single
      consumer stays a sibling file, not a concept skill.
- [ ] Pick the ending (rule 6): a router ends by naming what runs next; a worker ends with a fixed
      successor, back to its caller, or a declared terminal state — an internally forking worker ends
      by naming the sibling doc that continues the flow, with the terminal state declared in the doc
      where the flow ends; a concept has no ending at all — it writes no ending section, control
      simply returns to its reader. Know the exact wording before writing the body.
- [ ] If the change reshapes the system itself — a new role, a new meta-rule, a changed entry model or
      topology — stop: update `skills/SPEC.md` first, then come back here (rule 13).

## Write

- [ ] Name the skill verb-first, active voice, kebab-case (rule 15): a gerund for process skills, the
      topic for a concept — name the work or the insight, never the artifact or a role. Directory
      name = frontmatter `name`.
- [ ] Create `skills/<name>/SKILL.md` with frontmatter `name` + `description`. Nothing else changes —
      `package.json`'s `pi.skills` already points at `./skills`.
- [ ] `description` = triggering conditions only, "Use when …" (plus a "Not for …" negative trigger if
      the boundary is confusable) — never a summary of the steps (rule 5). Skills are reached by
      routing; a self-trigger description is for unmistakable triggers only (rule 4).
- [ ] Keep every file under ~150 lines (rule 3) — the `SKILL.md` spine and each sibling doc. Internal
      workflow nodes (branches, stages, shared tails) and heavy reference material live in sibling
      docs inside `skills/<name>/`, named in the exact step that hands to them; the spine carries the
      doc map, and each internal-node doc opens with a one-line contract (entry state, what it saves,
      where control goes next).
- [ ] Say each thing once (rule 7): cross-reference other skills by name; never inline another skill's
      steps, never force-load its files.
- [ ] Put gates where discipline matters, matching the form to the failure (rule 11): prohibitions +
      red flags for discipline violations, positive recipes for output shape.
- [ ] Durable output goes to the spec graph (rule 8). If the workflow needs ephemeral working files —
      resume state, scratch plans — declare them (rule 9): name the file's location and shape in the
      skill, consume/delete it when the work lands, and promote anything durable to specs before
      cleanup.
- [ ] End the body by naming the ending chosen in Design (rule 6) — a concept skips this: no ending
      section.

## Register (rule 12)

- [ ] Add one routing line in the router that owns the new skill: the root router
      (`skills/choosing-a-workflow/SKILL.md`) by default, or the nearest sub-router when the skill is
      a branch under an already-routed workflow (fractal routing). Exception (rule 4): a skill outside
      any router's work classification — self-trigger-only skills and concept skills — skips the
      router line; that's a designed property of the skill, never a size call, and it is instead named
      in `skills/SPEC.md`'s family table as outside the routing table.
- [ ] Add or update the skill's row in `skills/SPEC.md`'s **Workflow family** table, including its
      **Routed from** entry (which router routes to it — or that it sits outside the routing table).
- [ ] Nothing else should have changed shape — if it did, revisit rule 13 in Design.

## Verify by use (rule 14 — currently suspended)

- [ ] Rule 14 is a known limitation today, not a done-gate (see `skills/SPEC.md`). When practical,
      still run a real request through the new or changed skill and watch it flow: the router (or
      the description) triggers it, the body is followed, the ending fires as designed. For a
      concept: a referencing skill (or its self-trigger) loads it and its rules are applied.
- [ ] Either way, keep the family-table row honest: `unverified by use` until a run has been
      observed; update the row when one has.

## Red flags — stop and fix

- The `description` mentions any step of the workflow.
- The name is noun-first or names an artifact/role instead of the work (rule 15).
- The body of a router or worker ends without naming a successor or terminal state.
- A concept skill contains steps, routing, a handoff, or an ending section.
- The same rules are copied into two skills instead of extracted into a concept (rule 7).
- A step restates another skill's (or `skills/SPEC.md`'s) content instead of pointing at it.
- An internal node that nothing outside the skill reaches was made its own skill (or given
  frontmatter) — internal nodes are sibling docs, not skills (rule 1).
- "Too small to need a router line / family-table row." Every skill registers (rule 12); skipping the
  router line is only for self-trigger-only skills and concept skills per rule 4 — size is never the
  reason.
- Calling a skill *verified* without a real request observed flowing through it — rule 14 is
  suspended as a done-gate, but an unobserved skill is still `unverified by use`, never "verified".

## Done (terminal state)

This checklist ends here — no successor skill. Done means: `skills/<name>/SKILL.md` exists and passes
the checks above, and the router line and family-table row are in place — the row honestly marked
`unverified by use` until a real request has been observed flowing through the skill (rule 14,
currently suspended as a done-gate).
