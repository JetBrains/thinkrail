---
name: task-spec
description: Create an actionable task specification for a bug fix, feature implementation, or improvement. Use when the user wants to document a specific piece of work to be done.
argument-hint: "[task-title]"
---

# Task Specification Generator

You are creating an **actionable Task Specification**. Guide the user through structured choices to define exactly what needs to be done.

## IMPORTANT: Interaction Style

- Use the **AskUserQuestion** tool for every decision
- **Read related code and specs first** — understand context before asking
- Offer **2-4 choices** for task classification, scope, and priority
- The user should define a complete task in ~4-5 multi-choice decisions
- Auto-detect affected files from the codebase when possible
- Use terminal graphics from `/specdriven:visualisation` patterns for confirmations
- Apply colors from the `/specdriven:visualisation` Color Output Guide when rendering (ANSI codes for dark theme)

## Show Progress

Show current workflow position using `/specdriven:cli-progress` pattern before starting:

```
┌─────────────────────────────────────────────────────┐
│         Specification-Driven Development Progress   │
├─────────────────────────────────────────────────────┤
│ [✓] 1. Goal & Requirements    GOAL&REQUIREMENTS.md  │
│ [✓] 2. Architecture           DESIGN_DOC.md         │
│ [✓] 3. Module Specs           src/*/README.md       │
│  ▶  4. Task Specs             current_tasks/        │
└─────────────────────────────────────────────────────┘
```

## Step-by-Step Guided Process

### Step 1: Task classification

Use AskUserQuestion:

**Question 1 — Task type:**
- "Bug fix" — Something is broken and needs repair
- "New feature" — New functionality to implement
- "Improvement" — Existing feature needs enhancement
- "Refactor" — Code quality improvement, no behavior change

### Step 2: Affected component

If a codebase exists, scan for modules and use AskUserQuestion:

**Question 2 — Which component?**
- "{Module A}" — (with brief description auto-detected)
- "{Module B}" — (with brief description)
- "{Module C}" — (with brief description)
- "Multiple / cross-cutting" — Affects several modules

### Step 3: Scope and priority

Use AskUserQuestion:

**Question 3 — Scope:**
- "Small (1-2 files)" — Quick fix, localized change
- "Medium (3-5 files)" — Moderate change across a few files
- "Large (6+ files)" — Significant change, may need design discussion

**Question 4 — Priority:**
- "Critical" — Blocks other work or causes data loss
- "High" — Important for next release
- "Medium" — Should be done but not urgent
- "Low" — Nice to have, do when time permits

### Step 4: Auto-detect affected files

Based on the component selection, scan for relevant files. Present:
"These files are likely affected: [list]"

Use AskUserQuestion:
- "This file list is correct"
- "I need to add/remove files"
- "I'm not sure — skip file list for now"

### Step 5: Definition of done

Use AskUserQuestion (multiSelect: true):

**Question 5 — How will we know it's done?**
- "Tests pass" — Existing/new tests verify the fix
- "Manual verification" — Specific scenario works correctly
- "Performance target met" — Measurable improvement achieved
- "Code review approved" — Another person has reviewed the change

### Step 6: Generate the task spec

Generate `current_tasks/{module_path}/{type}_{name}.md`:
```markdown
# {Action verb} {component}: {specific description}

{Context: what the problem is and why it matters}

{Technical details auto-extracted from code analysis}

## Plan
1. {Step}
2. {Step}

## Files to modify
- {path} ({change description})

## Definition of done
- {Criteria from Step 5}

**Priority:** {from Step 3}
**Started:** {today's date}
```

### Step 7: Review and confirm

Use AskUserQuestion:
- "Looks good, save it"
- "I want to edit"
- "Start over"

## Prerequisites

Check for existing module specs — read them for context before asking questions.
Check `current_tasks/` for overlapping tasks.

## Registry Integration

After saving, update `.specs/registry.json`:
1. Add entry with `type: "task-spec"`, `status: "active"`, `tags: ["{priority}", "{type}"]`
2. Set `path` to the structured path (e.g., `current_tasks/spec/feature_spec_models.md`)
3. Add `implements` link to affected module spec
4. Add `depends-on` links if user specifies dependencies

## After Completion

Use AskUserQuestion:

**What's next?**
- "/task-spec — Create another task (Recommended)"
- "Start implementing this task"
- "/spec-status — Check overall coverage"
- "Done for now"
