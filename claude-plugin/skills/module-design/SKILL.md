---
name: module-design
description: Create a detailed module-level design specification (README.md for a major component). Use when the user wants to document a specific module's architecture, interfaces, and design.
argument-hint: "[module-path]"
---

# Module Design Specification Generator

You are helping the user create a **Module Design Specification** (README.md). Auto-detect everything possible from code, then guide design decisions with structured choices.

## IMPORTANT: Interaction Style

- Use the **AskUserQuestion** tool for every design decision
- **Read the module's code first** — extract public APIs, types, file structure
- Present your analysis: "I found X. Is this correct?"
- Offer **2-4 choices** for anything that requires human judgment
- The user should finalize a module spec in ~4-6 multi-choice decisions
- Use terminal graphics from `/specdriven:visualisation` patterns (component highlighting, box formatting)
- Apply colors from the `/specdriven:visualisation` Color Output Guide when rendering (ANSI codes for dark theme)

## Show Progress

Show current workflow position using `/specdriven:cli-progress` pattern before starting:

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

When specifying a module, show the architecture diagram with the current module highlighted using heavy-line box (`┏━━┓┗━━┛`).

## Prerequisites

Check: Does `DESIGN_DOC.md` exist and reference this module?
If not, use AskUserQuestion:
- "Create architecture doc first (/architecture-design) (Recommended)"
- "Skip, create module spec directly"

## Step-by-Step Guided Process

### Step 1: Auto-analyze the module

Read all source files in the target directory:
- List all files with line counts
- Extract public interfaces (exported functions, types, traits, classes)
- Identify the entry point / main API
- Map internal data flow
- Detect sub-modules
- Find tests (if any)

Present findings: "I analyzed `{module}/`. Here's what I found: [summary]."

### Step 2: Module purpose

Based on analysis, propose a 1-3 sentence module description. Use AskUserQuestion:

**Question 1 — Module description:**
- "Use my proposed description" — Accept auto-generated description
- "Adjust the description" — Let user refine
- "I'll write my own" — Open-ended

### Step 3: Architecture pattern (if complex)

If the module has multiple internal phases/stages, use AskUserQuestion:

**Question 2 — Internal structure:**
- "Pipeline: {A → B → C}" — Sequential processing stages
- "Single responsibility" — One entry point, one output, simple flow
- "Plugin/Strategy pattern" — Multiple implementations of an interface
- "Let me describe" — Custom structure

### Step 4: Public interface review

Present extracted public API. Use AskUserQuestion:

**Question 3 — API accuracy:**
- "This API listing is correct" — Use auto-extracted interface
- "I need to add/remove items" — Let user adjust
- "The main entry point is different" — Reframe around user's correction

### Step 5: Design decisions

For each non-obvious pattern in the code, use AskUserQuestion:

**Question 4+ — Why this approach?** (repeat per decision):
"I see `{pattern}` in the code. Why this approach?"
- "Simplicity" — Easier to understand and maintain
- "Performance" — Faster/more efficient than alternatives
- "Extensibility" — Easy to add new features later
- "Let me explain" — Complex rationale

### Step 6: Known limitations

Use AskUserQuestion (multiSelect: true):

**Question — Known limitations:**
- "Incomplete feature support" — Some features not yet implemented
- "Performance bottlenecks" — Known slow paths
- "Missing error handling" — Some error cases not covered
- "No known limitations" — Everything works as designed

### Step 7: Generate the specification

Generate README.md with:
- Module purpose from Step 2
- Pipeline/architecture diagram from Step 3
- Public interface table from Step 4
- Output contract table (extracted from return types)
- Internal file organization (auto-detected)
- Design decisions with rationale from Step 5
- Known limitations from Step 6
- Links to parent (DESIGN_DOC.md) and sub-module docs

### Step 8: Review and confirm

Use AskUserQuestion:
- "Looks good, save it" — Write to file
- "I want to edit sections" — Ask which
- "Start over" — Restart

## Registry Integration

After saving, update `.specs/registry.json`:
1. Add entry with `type: "module-design"`, `path`, `status: "active"`, `covers: ["{module}/"]`
2. Add `parent` link to DESIGN_DOC.md
3. Add `child` links to sub-module READMEs
4. Update DESIGN_DOC.md index if this module isn't listed

## After Completion

Use AskUserQuestion:

**What's next?**
- "/module-design {next-module} — Specify the next module (Recommended)"
- "/submodule-design — Detail a complex sub-component"
- "/task-spec — Create implementation tasks for this module"
- "Done for now"
