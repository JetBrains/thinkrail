---
id: task-workflow-system
type: task-spec
status: active
title: Workflow system — meta-concepts and meta-rules for the skill-based workflow family
parent: module-thinkrail-workflow
references: [module-spec-graph]
---

## Purpose

Grow `pi-thinkrail-workflow` from two ad-hoc skills (`brainstorming`, `project-setup`) into a
**workflow system**: a family of skills that lets the agent run work naturally — simple tasks, complex
tasks, bug fixes, new projects — with the spec graph as the artifact layer. This task designed the
system's **meta-layer** (concepts, rules, roles, routing/entry model) and tracks the remaining build
work. The meta-layer itself is promoted and lives in [[module-thinkrail-workflow]]'s SPEC.md ("The
workflow system") — that section is authoritative; nothing is restated here.

## Request (as understood)

- Flexible: adapts to simple vs. complex work rather than forcing one heavy process.
- A system of *skills* — easily extendable; adding a workflow must not change the system's shape.
- Branching rule (user-stated): each branch is its own skill; the skill before the fork holds the
  choice rules.
- Skills concise and workflow-focused; spec graph integrated as ground truth.
- Meta-concepts/meta-rules first; align before building.

## Decisions (consolidated; rationale in SPEC.md where promoted)

1. **Scope:** meta-layer + root router + authoring skill. Wider family designed later, one task-spec
   each. Retrofit of existing skills postponed (routed as-is).
2. **Entry model:** `before_agent_start` rule → root router **`choosing-a-workflow`** (repoint happens
   when the router lands; until then the rule keeps pointing at `brainstorming`).
3. **Meta-rules home:** SPEC.md (durable rationale) + **`writing-workflow-skills`** (actionable
   authoring checklist, points at SPEC.md).
4. **Artifacts:** durable = spec graph only; ephemeral per-workflow working files allowed with a
   declare-and-clean-up contract; pipeline state = a Pipeline section *inside* the task-spec.
5. **Roles:** collapsed from an initial 4 (router/worker/stage/composer) to **2 roles + handoff
   modes**; composer and stage are *patterns*, which dissolved the standalone-vs-stage dual-use
   question (the same worker can serve both ways).
6. **Composition** is a first-class meta-concept for complex work, but no machinery now; between-stage
   checking is each composer's own design, deliberately **not** a system rule.
7. **thinkrail-v1 workflows are not copied** — the user flagged them as broken/inflexible; they serve
   as an *example* of one possible future complex workflow. The family stays open and grows from real
   use; endorsed candidates: research/spike, refactor, bug-fix.
8. **Presentation:** meta-layer written as slim glossary + roles/contracts table + mermaid topology;
   meta-rules stay a numbered list (stable `meta-rule N` references).
9. **Final review:** user approved **spec promotion only**; the two skills + rule repoint are held for
   a later session.

## Research (digest; clones at `/tmp/thinkrail-research/`)

- **obra/superpowers** — gateway skill + explicit named handoffs between workflow skills; `description`
  = triggers only (never step summaries); token budgets; hard gates with anti-rationalization tables;
  "match the form to the failure".
- **gsd-build/gsd-2** (built on pi) — router-pattern skills (`SKILL.md` routes; `workflows/`,
  `references/`, `templates/` on demand); optional phases with explicit skip criteria; verification
  ladder. Its `.gsd/` artifact tree is a *contrast* — our artifact layer is the spec graph.
- **Anthropic guidance** — progressive disclosure; name/description as the discovery surface.
- **JetBrains/thinkrail-v1** — per-ticket composed stage pipelines (orchestrator + small stage skills,
  pipeline adjusted between stages; mandatory spec-diff stage; bug = spec/code discrepancy). Source of
  the composition concept; explicitly an example, not a template.

## Remaining work (held for a later session)

1. `skills/choosing-a-workflow/` — the root router (concise; routes to today's family only).
2. `skills/writing-workflow-skills/` — the authoring checklist.
3. Repoint the `before_agent_start` rule in `index.ts` at the router (byte-stable, pointer-only).
4. Verify by use (meta-rule 14): a real request through the router; walk the authoring skill once.

## Postponed (explicitly out of this task)

- Fate of `brainstorming` (keep/reshape/replace) and the quick-path boundary (mechanical asks
  bypassing design work).
- Designing any future workflow (research/spike, refactor, bug-fix, composer/stage workers).
- Any runtime/engine layer (YAML pipelines, DAG tools) — skills only.
