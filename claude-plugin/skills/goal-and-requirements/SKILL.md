---
name: goal-and-requirements
description: Define goal and requirements for a feature, improvement, or change in an existing project. Analyzes the existing codebase first, then helps scope and document what needs to be built. Use when code already exists.
icon: "🎯"
group: Foundation
argument-hint: "[describe what you want to build or change]"
---

# Goal & Requirements (Existing Project)

You are adding a clear specification to an **existing codebase**. Before asking anything, read the code. Your first job is to understand what already exists — the stack, the structure, the conventions — so every question and suggestion you make is grounded in the actual project.

**Principles:**
- Read code before asking questions
- Never ask about technology — the stack is already decided
- One question per turn
- Tailor every option to what you found in the code and what the user described
- Draft early, refine with the user — a concrete proposal beats an open-ended question

---

## Output

Creates or updates `GOAL&REQUIREMENTS.md` at the project root:

```markdown
# [Feature / Change Name]

> [One-sentence goal]

## Context

[What already exists that this builds on or changes. 2-3 sentences.]

## Problem

[What is broken, missing, or painful today. Who is affected.]

## Scope

### In this change
- [capability or change]
- [capability or change]

### Out of scope
- [explicitly excluded]

## Requirements

### Must have
| # | Requirement | Rationale |
|---|-------------|-----------|
| 1 | ...         | ...       |

### Nice to have
| # | Requirement | Rationale |
|---|-------------|-----------|
| 1 | ...         | ...       |

## Constraints

[Technical constraints from the existing codebase, integrations that must be preserved, breaking changes that must be avoided]
```

---

## Step 1 — Orient

Show workflow position via `bonsai_visualize` (type `progress-tracker`):

```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "current", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture",        "status": "pending", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs",        "status": "pending"},
      {"label": "Task Specs",          "status": "pending"},
      {"label": "Implementation",      "status": "pending"}
    ]
  }
}
```

---

## Step 2 — Analyze the codebase

**Do this before asking any questions.**

Read:
- `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` — language, framework, dependencies
- Directory structure — architecture pattern, module layout
- Existing `GOAL&REQUIREMENTS.md`, `DESIGN_DOC.md`, `.bonsai/` spec files if present
- Any files directly relevant to what `$ARGUMENTS` describes

Build a mental model: what does this project do, what tech is it using, what conventions does it follow, what area would this change touch?

Show findings via `bonsai_visualize` (type `summary-box`):

```json
{
  "type": "summary-box",
  "title": "Project Context",
  "visId": "project-context",
  "data": {
    "sections": [
      {"heading": "Stack",        "items": [{"label": "Language",   "value": "..."}, {"label": "Framework", "value": "..."}]},
      {"heading": "Structure",    "items": [{"label": "Pattern",    "value": "..."}, {"label": "Key modules", "value": "..."}]},
      {"heading": "Relevant area","items": [{"label": "Touch points","value": "..."}]}
    ]
  }
}
```

Use `AskUserQuestion` to confirm before proceeding:
- "Yes, that's accurate"
- "The relevant area is actually: _____"
- "There's important context you missed: _____"

---

## Step 3 — Clarify the change

Take `$ARGUMENTS` as the initial description. From it and your code analysis, infer the core intent. State your interpretation and confirm.

**Pattern:**
> "So you want to [specific change] in [specific area of the codebase], because [inferred reason]. The main users of this would be [inferred user]. Is that right?"

Use `AskUserQuestion`:
- "Yes, that's it"
- "The scope is different: _____"
- "The reason is actually: _____"
- "The users affected are: _____"

---

## Step 4 — Define scope

Propose what's in and what's out for this change. Ground it in the existing codebase — reference real modules, APIs, or data models.

Show via `bonsai_visualize` (type `summary-box`, `visId: "change-scope"`):

```json
{
  "type": "summary-box",
  "title": "Proposed Scope",
  "visId": "change-scope",
  "data": {
    "sections": [
      {
        "heading": "In this change",
        "items": [
          {"label": "✓", "value": "[specific change referencing real code]"},
          {"label": "✓", "value": "[another specific change]"}
        ]
      },
      {
        "heading": "Out of scope",
        "items": [
          {"label": "✗", "value": "[related thing that's tempting but separate]"}
        ]
      }
    ]
  }
}
```

Use `AskUserQuestion`:
- "Scope is right"
- "Add [something] to scope"
- "Remove [something] from scope"
- "Redefine"

---

## Step 5 — Requirements

Based on confirmed scope, derive must-have requirements. For each, propose 3–5 concrete requirements and ask the user to confirm or adjust.

Show ongoing requirements state via `bonsai_visualize` (type `summary-box`, `visId: "requirements-summary"`). Update it after each confirmation.

Group into:
- **Must have** — the change doesn't ship without these
- **Nice to have** — valuable but not blocking
- **Constraints** — things from the existing codebase that must be preserved (API contracts, data formats, performance SLAs, etc.)

---

## Step 6 — Draft and confirm

Draft the full `GOAL&REQUIREMENTS.md`. Show compact summary via `bonsai_visualize` (type `summary-box`, `visId: "goal-draft"`).

Use `AskUserQuestion`:
- "Save it"
- "Revise the scope"
- "Revise the requirements"
- "Revise the constraints"
- "Start over"

---

## Step 7 — Save

Use `Write` to create `GOAL&REQUIREMENTS.md` with YAML frontmatter (`type: "goal-and-requirements"`, `status: "active"`).

If there are related module specs already in the registry, include `references` fields directly in the YAML frontmatter.

Confirm: "Saved to `GOAL&REQUIREMENTS.md`."

Update the progress tracker (`visId: "workflow-progress"`).

---

## Step 8 — What's next

Use `SuggestSession` to propose the most logical next step based on what was specified — typically `architecture-design` or `task-spec` for smaller changes.

Then use `AskUserQuestion`:
- "Continue to Architecture Design — design the system before building"
- "Start implementing — skip design and build now"
- "Check spec coverage (`/spec-status`)"
- "Done for now"

If the user picks **"Start implementing"**, call `SuggestSession`:

```json
{
  "skill": "task-spec",
  "name": "Build v1",
  "reason": "Implement the features from GOAL&REQUIREMENTS.md",
  "prompt": "Read GOAL&REQUIREMENTS.md (and DESIGN_DOC.md / module README.md files if they exist). For each feature listed under 'In v1': 1) implement it following the specs, 2) run a spec alignment check — if discrepancies exist show them via bonsai_visualize summary-box titled 'Spec vs Code' then use AskUserQuestion (one at a time): 'Update spec to match code' / 'Update code to match spec' / 'Leave as-is'. Only move to the next feature after resolving all discrepancies."
}
```

---

## Anti-patterns

- **Do not** ask about technology — read the code instead
- **Do not** ask "is this a new project?" — that's what `new-project` skill is for
- **Do not** ask about Priority as a standalone question — priority lives on individual requirements
- **Do not** ask multiple questions in one turn
- **Do not** offer generic options — reference the actual codebase in every suggestion
