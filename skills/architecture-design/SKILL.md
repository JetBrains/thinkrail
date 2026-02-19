---
name: architecture-design
description: Create a system-wide architecture design document. Use when the user wants to document the overall system architecture, data flow, and design decisions for their project.
argument-hint: "[project-name]"
---

# Architecture Design Specification Generator

You are helping the user create an **Architecture Design Document** (DESIGN_DOC.md). Guide them through structured questions — auto-detect as much as possible from existing code.

## IMPORTANT: Interaction Style

- Use the **AskUserQuestion** tool for every design decision
- Offer **2-4 concrete choices** per question
- **Read the codebase first** — auto-detect components, dependencies, and patterns
- Present your analysis and ask user to confirm/correct, not start from scratch
- The user should finalize an architecture doc in ~5-7 multi-choice decisions
- Use terminal graphics from `/specdriven:visualisation` patterns for diagrams and confirmations
- Apply colors from the `/specdriven:visualisation` Color Output Guide when rendering (ANSI codes for dark theme)

## Step-by-Step Guided Process

### Step 0: Show Progress

Show current workflow position using `/specdriven:cli-progress` pattern:

```
┌─────────────────────────────────────────────────────┐
│         Specification-Driven Development Progress   │
├─────────────────────────────────────────────────────┤
│ [✓] 1. Goal & Requirements    GOAL&REQUIREMENTS.md  │
│  ▶  2. Architecture           DESIGN_DOC.md         │
│ [ ] 3. Module Specs           src/*/README.md       │
│ [ ] 4. Task Specs             current_tasks/        │
└─────────────────────────────────────────────────────┘
```

### Step 1: Auto-detect architecture

Read the codebase:
- Scan all top-level directories under `src/`, `lib/`, `app/`, `pkg/`, etc.
- Read entry points (`main.*`, `index.*`, `app.*`, `mod.rs`, `__init__.py`)
- Map import/dependency relationships between modules
- Identify data types flowing between modules

Present findings: "I found these major components: [list]. Here's how they seem to connect: [diagram]."

### Step 2: Architecture pattern with visual comparison

Provide several most-common architecture approaches for the goal and **visualize them side-by-side** (or sequentially if they don't fit):

```
#1 [Approach Name]                   ║  #2 [Approach Name]
                                     ║
[ASCII diagram 1]                    ║  [ASCII diagram 2]
                                     ║
**Component Name**                   ║  **Component Name**
  - Purpose: [short]                 ║    - Purpose: [short]
  - Input: [what]                    ║    - Input: [what]
  - Output: [what]                   ║    - Output: [what]
                                     ║
**Key Technologies**                 ║  **Key Technologies**
  - [tech 1]                         ║    - [tech 1]
  - [tech 2]                         ║    - [tech 2]
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

Based on code analysis, present the discovered type flow and use AskUserQuestion:

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

Generate `DESIGN_DOC.md` with:
- ASCII art pipeline diagram based on architecture pattern choice (use `/specdriven:visualisation` box and arrow patterns)
- Annotated source tree from auto-detection
- Data flow with concrete types from code analysis
- Design decisions with rationale from user choices
- Sub-module documentation index with links

### Step 8: Visual confirmation and review

Show complete architecture in a confirmation box:

```
╔════════════════════════════════════════════════════════╗
║ CORE ARCHITECTURE DESIGN                               ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║ Main Components: [count]                               ║
║ [Component list]                                       ║
║                                                        ║
║ Architecture Diagram:                                  ║
║ [ASCII diagram]                                        ║
║                                                        ║
║ Key Data Flows:                                        ║
║ - [Flow 1]                                             ║
║ - [Flow 2]                                             ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
```

Use AskUserQuestion:
- "Looks good, save it" — Write to file
- "I want to edit sections" — Ask which
- "Start over" — Restart

## Registry Integration

After saving, update `.specs/registry.json`:
1. Add entry with `type: "architecture-design"`, `status: "active"`
2. Add `child` links to any module READMEs referenced
3. Add `parent` link from README.md

## After Completion

Use AskUserQuestion:

**What's next?**
- "/module-design — Specify the first major module (Recommended)"
- "/spec-status — Check specification coverage"
- "/spec-from-code — Generate module spec skeletons from code"
- "Done for now"
