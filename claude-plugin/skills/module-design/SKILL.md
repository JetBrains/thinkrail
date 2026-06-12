---
name: module-design
description: Create a detailed module-level design specification (README.md for a major component). Use when the user wants to document a specific module's architecture, interfaces, and design.
icon: "📦"
group: Creation
argument-hint: "[module-path]"
---

# Module Design Specification Generator

You are helping the user create a **Module Design Specification** (README.md). Auto-detect everything possible from code, then guide design decisions with structured choices. Read the module's code first — extract public APIs, types, file structure. Present your analysis: "I found X. Is this correct?" The user should finalize a module spec in ~4-6 multi-choice decisions.

## Show Progress

Show current workflow position by calling `thinkrail_visualize` with type `progress-tracker`:
```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "done", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture", "status": "done", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs", "status": "current"},
      {"label": "Task Specs", "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

When specifying a module, highlight the current module using `thinkrail_visualize` `diagram` type with the module marked as `current`.

## Prerequisites

Use `spec_search` with `type: "architecture-design"` to check if a DESIGN_DOC.md exists. If it does, use `Read` to read it and verify it references this module.
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

Before writing, show the module's architecture using `thinkrail_visualize` with type `diagram`:
```json
{
  "type": "diagram",
  "title": "{Module Name} Architecture",
  "visId": "module-arch-{module}",
  "data": {
    "nodes": [
      {"id": "comp1", "label": "{Component 1}", "status": "current"},
      {"id": "comp2", "label": "{Component 2}"},
      {"id": "comp3", "label": "{Component 3}"}
    ],
    "edges": [
      {"from": "comp1", "to": "comp2", "label": "{relationship}"},
      {"from": "comp2", "to": "comp3", "label": "{relationship}"}
    ]
  }
}
```

Use `Write` to create the module README.md with YAML frontmatter (`type: "module-design"`, `status: "active"`, `covers: ["{module}/"]`). Include:
- Module purpose from Step 2
- Architecture description from Step 3 (reference the thinkrail_visualize diagram shown above; do NOT put ASCII art diagrams in the README — use plain text or mermaid if needed)
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

Include `parent` and `depends-on` fields directly in the YAML frontmatter:
1. Add `parent` field pointing to DESIGN_DOC.md
2. Add `parent` fields in sub-module READMEs pointing to this module

If this module isn't listed in DESIGN_DOC.md, use Edit to update its Module Index.

## After Completion

Use `SuggestSession` to propose follow-up sessions (up to 3, prioritized):
1. `submodule-design` for each complex sub-component discovered during analysis (Step 1). Include the module spec ID in `specIds` and describe the sub-component's role in `prompt`.
2. `module-design` for remaining unspecified modules from DESIGN_DOC.md. Include architecture + module spec IDs in `specIds`.
3. `task-spec` for implementation tasks on the module just completed. Include the module spec ID in `specIds`.

Then use `AskUserQuestion`:
- "Done for now"
