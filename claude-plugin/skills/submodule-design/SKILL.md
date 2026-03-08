---
name: submodule-design
description: Create a design specification for a sub-component within a module. Use for documenting specific algorithms, sub-systems, or focused components.
argument-hint: "[submodule-path]"
---

# Sub-Module Design Specification Generator

You are creating a **Sub-Module Design Specification** (README.md for a sub-component). Auto-detect from code, guide decisions with structured choices.

## IMPORTANT: Interaction Style

- Use the **AskUserQuestion** tool for every design decision
- **Read the code first** — extract algorithms, data structures, interfaces
- Present analysis and ask user to confirm/correct
- Offer **2-4 choices** for judgment calls
- The user should finalize in ~3-5 multi-choice decisions
- Use `bonsai_visualize` tool with structured data for all visualizations (diagrams, confirmations)
- **NEVER** use ASCII box-drawing characters (`┌─┐`, `╔═╗`, `+---+`, etc.) in text output
- **NEVER** use Bash, echo, printf, or ANSI escape codes for visual output

## Prerequisites

Check: Does the parent module have a README.md?
If not, use AskUserQuestion:
- "Create parent module spec first (/module-design) (Recommended)"
- "Skip, create sub-module spec directly"

## Step-by-Step Guided Process

### Step 1: Auto-analyze the sub-module

Read all source files:
- Extract key data structures and their fields
- Identify the core algorithm or processing logic
- Map entry points and their signatures
- Count files and their responsibilities

Present: "I analyzed `{path}`. Here's the core: [summary]."

### Step 2: Why it exists

Use AskUserQuestion:

**Question 1 — Why is this a separate component?**
- "Complex algorithm" — Contains a non-trivial algorithm that deserves dedicated docs
- "Reusable component" — Used by multiple parts of the system
- "Performance-critical" — Requires detailed optimization documentation
- "Let me explain" — Custom reason

### Step 3: Algorithm/approach

If algorithmic, present your analysis and use AskUserQuestion:

**Question 2 — Algorithm description accuracy:**
- "Your analysis is correct" — Use auto-detected algorithm description
- "I need to correct some details" — User provides corrections
- "This isn't algorithmic — it's structural" — Reframe as data/organization doc

### Step 4: Design decisions

For each non-obvious choice, use AskUserQuestion:

**Question 3+ — Design rationale:**
"I see `{choice}`. Why?"
- "Performance" — Optimized for speed/memory
- "Simplicity" — Easiest correct implementation
- "Compatibility" — Matches external interface/standard
- "Let me explain" — Complex rationale

### Step 5: Generate the specification

Generate README.md with:
- Title and purpose
- Why this exists (from Step 2)
- Algorithm/architecture description (from Step 3)
- Data structures table (auto-extracted)
- Design decisions with rationale (from Step 4)
- File layout table (auto-detected)
- Link to parent module README

### Step 6: Review and confirm

Use AskUserQuestion:
- "Looks good, save it"
- "I want to edit sections"
- "Start over"

## Registry Integration

After saving, update `.specs/registry.json`:
1. Add entry with `type: "submodule-design"`, `status: "active"`, `covers: ["{path}/"]`
2. Add `parent` link to parent module README
3. Update parent module's Module Index to include this sub-module

## After Completion

Use AskUserQuestion:

**What's next?**
- "/submodule-design {next} — Specify another sub-component (Recommended)"
- "/module-design — Specify the next major module"
- "/task-spec — Create implementation tasks"
- "Done for now"
