---
name: spec-next
description: Suggest what to specify next based on current coverage, dependencies, and priority. Use when you're unsure what specification to create next.
---

# Specification Workflow Orchestrator

You are the **workflow orchestrator** for specification-driven development. You analyze the current state of specifications and recommend what to create or update next.

## Process

### Step 1: Assess current state

1. Read `.specs/registry.json` (if missing, recommend `/spec-init`)
2. Check for `GOAL&REQUIREMENTS.md`
3. Scan the project for source directories and existing specs
4. Build a coverage map

### Step 2: Apply the dependency graph

Specifications have a natural dependency order. Later specs depend on earlier ones:

```
Level 0: /spec-init (project scaffolding)
    ↓
Level 1: /goal-and-requirements (GOAL&REQUIREMENTS.md — goal, requirements, tech stack)
    ↓
Level 2: /architecture-design (DESIGN_DOC.md)
    ↓
Level 3: /module-design (one per major module)
    ↓
Level 4: /submodule-design (for complex sub-components)
    ↓
Level 5: /task-spec (implementation tasks)
```

**Rules:**
- Don't recommend Level N+1 specs until Level N is complete
- Within a level, prioritize by: most-used module first, largest module first
- Stale specs (code changed since last spec update) take priority over new specs
- Missing specs for existing code take priority over specs for planned code

### Step 3: Show current progress

Display workflow progress using `/specdriven:cli-progress` pattern:

```
┌─────────────────────────────────────────────────────┐
│         Specification-Driven Development Progress   │
├─────────────────────────────────────────────────────┤
│ [✓] 1. Goal & Requirements    GOAL&REQUIREMENTS.md  │
│ [✓] 2. Architecture           DESIGN_DOC.md         │
│  ▶  3. Module Specs           src/*/README.md       │
│ [ ] 4. Task Specs             current_tasks/        │
└─────────────────────────────────────────────────────┘
```

### Step 4: Check for stale specs

For each existing spec, compare its modification time against the code it covers.
Stale specs are the highest priority — they represent documentation debt.

### Step 5: Generate recommendations

Output a prioritized list:

```markdown
# What to Specify Next

## Current State
- Spec coverage: {X}% ({N} specs covering {M} of {T} modules)
- Stale specs: {N}
- Missing specs: {N}

## Priority 1: Foundation Specs

1. **Define goal and requirements** — No GOAL&REQUIREMENTS.md found
   Run: `/goal-and-requirements`

## Priority 2: Update Stale Specs
These specs are out of date with their code:

3. **Update `src/parser/README.md`** — Code changed 3 days after spec
   Run: `/spec-review src/parser/`

## Priority 3: Fill Coverage Gaps
These modules have code but no specification:

4. **Create spec for `src/auth/`** — {N} source files, no README
   Run: `/module-design src/auth`

## Priority 4: Next in Workflow
Based on the dependency graph, you should create:

5. **Create task specs** — Architecture and modules are documented, ready for implementation tasks
   Run: `/task-spec`

## Priority 5: Suggested Improvements
6. **Add sub-module specs** for complex components in `src/parser/`
   Run: `/submodule-design src/parser/optimizer`
```

### Step 6: Offer to act

Use AskUserQuestion with the top recommendations:

**What should we work on?**
- "{Top recommendation} (Recommended)" — e.g., "/goal-and-requirements — Define goal and requirements"
- "{Second recommendation}" — e.g., "/architecture-design — Document system architecture"
- "{Third recommendation}" — e.g., "/module-design src/auth — Create missing spec"
- "Nothing for now" — Exit

## Priority Rules (in order)

1. **Missing foundation**: No registry → `/spec-init`
2. **Missing goal & requirements**: No GOAL&REQUIREMENTS.md → `/goal-and-requirements`
3. **Missing architecture**: No DESIGN_DOC.md → `/architecture-design`
4. **Stale specs**: Code changed since spec update → `/spec-review`
5. **Missing module specs**: Code exists without spec → `/module-design`
6. **Missing sub-module specs**: Complex modules without detail → `/submodule-design`
7. **Implementation tasks**: Specs exist, no tasks → `/task-spec`

## Key Principles

- **Always actionable**: Every recommendation includes the exact command to run
- **Respect dependencies**: Don't suggest advanced specs before foundations are done
- **Stale > Missing**: Updating existing stale specs is more important than creating new ones
- **Explain why**: Each recommendation includes the reason it's prioritized
- **Visual progress**: Always show the workflow progress visualization
