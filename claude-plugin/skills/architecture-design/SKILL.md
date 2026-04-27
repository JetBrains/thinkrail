---
name: architecture-design
description: Create a system-wide architecture design document. Use when the user wants to document the overall system architecture, data flow, and design decisions for their project.
icon: "🏛"
group: Foundation
argument-hint: "[project-name]"
---

# Architecture Design Specification Generator

You are helping the user create an **Architecture Design Document** (DESIGN_DOC.md). Guide them through structured questions — auto-detect as much as possible from existing code. Read the codebase first, present your analysis and ask the user to confirm/correct — not start from scratch. The user should finalize an architecture doc in ~5-7 multi-choice decisions.

## Step-by-Step Guided Process

### Step 0: Show Progress

Show current workflow position by calling `bonsai_visualize` with type `progress-tracker`:
```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "done", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture", "status": "current", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs", "status": "pending"},
      {"label": "Task Specs", "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

### Step 1: Auto-detect architecture

Read the codebase:
- Scan all top-level directories under `src/`, `lib/`, `app/`, `pkg/`, etc.
- Read entry points (`main.*`, `index.*`, `app.*`, `mod.rs`, `__init__.py`)
- Map import/dependency relationships between modules
- Identify data types flowing between modules

Present findings: "I found these major components: [list]. Here's how they seem to connect: [diagram]."

### Step 2: Architecture pattern with visual comparison

Provide several most-common architecture approaches for the goal and **visualize them side-by-side** using `bonsai_visualize` with type `comparison`. Include a `visualization` field with a Mermaid diagram illustrating each approach's component structure:
```json
{
  "type": "comparison",
  "title": "Architecture Approaches",
  "visId": "arch-comparison",
  "data": {
    "options": [
      {
        "name": "[Approach 1]",
        "description": "[Brief description]",
        "visualization": "graph TD\n  A[Component A] --> B[Component B]\n  B --> C[Component C]",
        "pros": ["[pro 1]", "[pro 2]"],
        "cons": ["[con 1]", "[con 2]"]
      },
      {
        "name": "[Approach 2]",
        "description": "[Brief description]",
        "visualization": "graph LR\n  X[Service X] --> Y[Service Y]\n  X --> Z[Service Z]",
        "pros": ["[pro 1]", "[pro 2]"],
        "cons": ["[con 1]", "[con 2]"]
      }
    ]
  }
}
```

MUST show visualizations! Then use AskUserQuestion:

**Which architecture pattern do you prefer?**
- "Pipeline / Phases" — Data flows through sequential stages (A -> B -> C)
- "Layered / Onion" — Layers with dependency rules (UI -> Business -> Data)
- "Microservices / Modules" — Independent components communicating via APIs
- "Event-driven" — Components react to events/messages

### Step 3: Component boundaries

Based on auto-detection, present the discovered modules and use AskUserQuestion:

**Question 2 — Component grouping:**
Present 2-3 alternative ways to group the discovered modules. For example:
- "Group A: {frontend, backend, database} — by layer"
- "Group B: {auth, users, billing, api} — by domain"
- "Group C: {current structure is fine} — keep as-is"

### Step 4: Data flow

Based on code analysis, present the discovered type flow. Visualize it using `bonsai_visualize` with type `diagram` (use structured `nodes`/`edges`, NOT ASCII art):
```json
{
  "type": "diagram",
  "title": "Data Flow",
  "visId": "data-flow",
  "data": {
    "nodes": [
      {"id": "input", "label": "User Input"},
      {"id": "parser", "label": "Parser"},
      {"id": "engine", "label": "Processing Engine"},
      {"id": "output", "label": "Output"}
    ],
    "edges": [
      {"from": "input", "to": "parser", "label": "raw data"},
      {"from": "parser", "to": "engine", "label": "parsed"},
      {"from": "engine", "to": "output", "label": "result"}
    ],
    "layout": "left-to-right"
  }
}
```

Then use AskUserQuestion:

**Question 3 — Data flow accuracy:**
- "This looks correct" — Use the auto-detected flow
- "I need to adjust the flow" — Let user describe corrections
- "Generate from scratch" — Discard auto-detection, ask user to describe

### Step 5: Key design decisions

For each non-obvious architectural choice detected in the code, use AskUserQuestion:

**Question 4+ — Design rationale** (repeat for each decision):
"I see you chose {X}. Why?"
- "{Reason A}" — e.g., "Simplicity — easier to implement and maintain"
- "{Reason B}" — e.g., "Performance — faster than the alternative"
- "{Reason C}" — e.g., "Compatibility — matches existing ecosystem patterns"
- "Let me explain" — Open-ended for complex rationale

### Step 6: Design philosophy

Use AskUserQuestion:

**Question — Core design principles** (multiSelect: true):
- "Separation of concerns" — Each module has one clear responsibility
- "Convention over configuration" — Sensible defaults, minimal config
- "Explicit over implicit" — No magic, everything is visible
- "Performance first" — Optimize for speed even at complexity cost

### Step 7: Generate the document

Use `Write` to create `DESIGN_DOC.md` with YAML frontmatter (`type: "architecture-design"`, `status: "active"`). Include:
- Architecture diagram generated via `bonsai_visualize` `diagram` type
- Annotated source tree from auto-detection
- Data flow with concrete types from code analysis
- Design decisions with rationale from user choices
- Sub-module documentation index with links

### Step 8: Visual confirmation and review

Show complete architecture using `bonsai_visualize` with type `summary-box`:
```json
{
  "type": "summary-box",
  "title": "Core Architecture Design",
  "visId": "arch-confirmation",
  "data": {
    "sections": [
      {"heading": "Main Components", "items": [
        {"label": "Count", "value": "[count]"},
        {"label": "Components", "value": "[component list]"}
      ]},
      {"heading": "Key Data Flows", "items": [
        {"label": "Flow 1", "value": "[description]"},
        {"label": "Flow 2", "value": "[description]"}
      ]},
      {"heading": "Design Decisions", "items": [
        {"label": "Pattern", "value": "[chosen pattern]"},
        {"label": "Rationale", "value": "[key rationale]"}
      ]}
    ]
  }
}
```

Use AskUserQuestion:
- "Looks good, save it" — Write to file
- "I want to edit sections" — Ask which
- "Start over" — Restart

## Registry Integration

Include `parent` and `depends-on` fields directly in the YAML frontmatter of related specs:
1. Add `parent` fields in module READMEs pointing to this architecture doc
2. Add `parent` field in README.md

## After Completion

Use `Read` to read the DESIGN_DOC.md module list and use `SuggestSession` to propose a `module-design` session for each major module (up to 3, prioritized by dependency order). Include the architecture spec ID (and goal spec ID if it exists) in `specIds`. Carry forward each module's path and key responsibilities in the `prompt`.

Then use `AskUserQuestion`:
- "/spec-from-code — Generate module spec skeletons from code"
- "/spec-status — Check specification coverage"
- "Done for now"
