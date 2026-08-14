// The built-in type cards, embedded as full markdown card texts and parsed by `types.ts`'s card parser
// (dogfooding the format). String constants — NOT package .md files — because `core/` is value-imported
// by hosts (thinkrail's server) and bundled into compiled binaries, where import.meta.url-relative file
// resolution would break (see module-spec-graph "Spec types"). Pi-free; no imports at all.
//
// The five original types keep their historical scaffold headings as `sections`, so spec_create's
// scaffolding behavior is unchanged for them. Card bodies avoid backticks (template-literal source).

const GOAL_AND_REQUIREMENTS = `---
name: goal-and-requirements
title: Goal & requirements
description: The product goal and scope — what the project is for, for whom, and what is in and out. The root of the spec graph.
lifecycle: durable
home: repo root (one per project)
sections: [Goal, Scope]
---

# Goal & requirements

The root document: why the project exists, who it serves, and the scope line (V1 vs later, in vs
out). Usually one per project, at the repository root.

## Quality bar

- States the goal as user-visible outcomes, not implementation.
- The scope section draws a real line: named non-goals and deferrals, not just inclusions.
- Requirements that are settled decisions live here; open wishes do not.
`;

const ARCHITECTURE_DESIGN = `---
name: architecture-design
title: Architecture design
description: System-wide topology, cross-cutting decisions, and the invariants every module must hold. Sits between the goal and the module specs.
lifecycle: durable
home: repo root
sections: [Drivers, Decisions, Invariants, Out of scope]
links:
  parent: goal-and-requirements
---

# Architecture design

The system-wide view: the shape of the system, the decisions that cut across modules, and the
invariants the modules must not break. Decisions recorded here bind the module specs below.

## Quality bar

- Each decision carries its why — the driver or constraint that forced it, and what was rejected.
- Invariants are testable statements, not aspirations.
- Module-local detail belongs in the module's own spec; link to it instead of restating.
`;

const MODULE_DESIGN = `---
name: module-design
title: Module design
description: A package or top-level module's responsibility and boundary — what it owns, its public surface, and what it must not reach into.
lifecycle: durable
home: <module>/SPEC.md (co-located with the module)
sections: [Responsibility, Boundary]
links:
  parent: architecture-design
---

# Module design

One spec per genuine module boundary, co-located with the code it describes. It captures what the
files do not say: intent, ownership, and the boundary (allowed and forbidden dependencies).

## Quality bar

- Explains intent, not inventory — never a file-by-file transcript of the directory.
- The boundary section names the public surface, allowed deps, and forbidden reaches explicitly.
- Dependency edges between child sub-modules live here (the parent), not in each leaf.
`;

const SUBMODULE_DESIGN = `---
name: submodule-design
title: Sub-module design
description: The responsibility and boundary of a directory-level module inside a package — same bar as module-design, one level down.
lifecycle: durable
home: <module>/<dir>/SPEC.md (co-located with the sub-module)
sections: [Responsibility, Boundary]
links:
  parent: module-design
---

# Sub-module design

The fractal continuation of module-design: a directory with a barrel as its public surface gets its
own spec when it holds a genuine boundary — not one per directory by default.

## Quality bar

- Declares only its own external deps and forbidden reaches; edges to siblings live in the parent's
  spec.
- Small enough to read in one sitting; if it rivals the parent spec in size, the boundary is
  probably wrong.
`;

const TASK_SPEC = `---
name: task-spec
title: Task spec
description: A temporary working document for one piece of work — the design, decisions, and open questions while the work is alive. Retired when it lands.
lifecycle: ephemeral
home: .thinkrail/context/ (the gitignored scratch dir; keeping one in-repo is allowed when history or review wants it)
sections: [Purpose, Open items]
---

# Task spec

The working memory of one task: the request, the decisions as they land, approaches considered, and
what the user deferred. Scoped to one piece of work — accreting unrelated decisions means it should
split.

## Quality bar

- States up front its retirement criteria and its promotion targets: which durable specs absorb
  which settled decisions when the work lands.
- Ends by promotion, not deletion — settled contracts, boundaries, and decisions fold into the
  durable specs that own them; then the task spec retires.
- Never authoritative: durable specs win on any conflict.
`;

const CHARTER = `---
name: charter
title: Spec charter
description: The project's declared stance on specs — how authoritative they are, what agents must read before working, and the review bar for spec changes.
lifecycle: durable
home: repo root (one per project)
sections: [Stance, What agents read first, Review bar]
---

# Spec charter

Different projects legitimately treat specs differently — from helpful context to source-like ground
truth. The charter makes the stance explicit so humans and agents stop guessing: where the project
sits on the spec-first / spec-anchored / spec-as-source spectrum, what must be read before touching
code, and how spec changes are reviewed.

## Quality bar

- The stance is one honest sentence plus its consequences, not a manifesto.
- "What agents read first" is a short ordered list of spec ids, not a directory listing.
- If the project's practice drifts from the charter, one of them changes — the charter is as
  falsifiable as any other spec.
`;

const DECISION = `---
name: decision
title: Decision record (ADR)
description: One significant, hard-to-reverse decision — its context, the options weighed, the outcome, and the consequences. Append-only history.
lifecycle: durable
home: docs/decisions/
sections: [Context, Options considered, Decision, Consequences]
statuses: [proposed, accepted, superseded]
---

# Decision record

Use when a choice is significant and hard to reverse; one decision per file, never a running log.
Status flows proposed -> accepted -> superseded.

## Quality bar

- States the rejected options and why — that is the part code can never reveal.
- Superseding a decision means a new record that links the old one (a references link plus prose,
  until a dedicated link kind exists); the old record is never edited, only marked superseded.
- Context explains the forces at decision time, so a future reader can judge whether they still
  hold.
`;

/** The seven built-in cards, in canonical display order. */
export const BUILTIN_SPEC_TYPE_CARDS: readonly string[] = [
	GOAL_AND_REQUIREMENTS,
	ARCHITECTURE_DESIGN,
	MODULE_DESIGN,
	SUBMODULE_DESIGN,
	TASK_SPEC,
	CHARTER,
	DECISION,
];
