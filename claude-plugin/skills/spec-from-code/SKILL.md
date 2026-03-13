---
name: spec-from-code
description: Reverse-engineer specifications from existing code. Analyzes directory structure, public APIs, data flow, and generates spec skeletons. Use when adding specs to an existing codebase.
argument-hint: "[path-to-analyze]"
---

# Reverse-Engineer Specifications from Code

You are analyzing an existing codebase to **generate specification skeletons**. This is the reverse path: code → specs, instead of specs → code. The generated specs need human review and refinement, but they provide a strong starting point.

## Quick Context

Before analyzing, read `.specs/registry.json` for existing specs and their `covers` entries. Compare against source directories to identify coverage gaps.

## What You Will Generate

Depending on the scope:
- **Full project**: README.md skeleton + DESIGN_DOC.md skeleton + module READMEs
- **Single module**: Module README.md with full detail
- **Single file**: Contribution to parent module's README

## Process

### Step 1: Determine scope

If `$ARGUMENTS` is provided, analyze that specific path. Otherwise use AskUserQuestion:

**Question 1 — Scope:**
- "Entire project" — Generate specs for all modules
- "Specific module" — Generate spec for one directory (ask which)
- "Just architecture" — Generate only DESIGN_DOC.md skeleton

### Step 2: Analyze project structure

Scan the codebase to discover:

1. **Project type**: Look for `package.json`, `Cargo.toml`, `setup.py`, `go.mod`, `pom.xml`, `Makefile`, etc.
2. **Language**: Determine primary language from file extensions
3. **Directory structure**: Map all directories and their contents
4. **Entry points**: Find `main.*`, `index.*`, `app.*`, `lib.*` files
5. **Configuration**: Look for config files, env examples, docker files
6. **Tests**: Find test directories and test files
7. **Existing docs**: Find any README, docs, or specification files already present

### Step 3: Analyze code structure

For each major directory/module:

1. **Read key files** (entry points, mod.rs, index.ts, __init__.py, etc.)
2. **Extract public interfaces**:
   - Exported functions/methods with their signatures
   - Public types/structs/classes/interfaces
   - Exported constants and configuration
3. **Identify data flow**:
   - What types flow in (function parameters)
   - What types flow out (return types)
   - What external dependencies are used
4. **Map internal organization**:
   - How many files, what does each do
   - Sub-modules and their roles
5. **Identify patterns**:
   - Pipeline patterns (A → B → C)
   - Plugin/trait patterns
   - Event-driven patterns
   - Request/response patterns

### Step 4: Generate Architecture Design skeleton

If analyzing the full project, generate a `DESIGN_DOC.md` skeleton:

```markdown
# {Project Name} Design Document

{Auto-generated from code analysis. Review and refine.}

---

## High-Level Architecture

{Generate architecture diagram using `bonsai_visualize` `diagram` type — do NOT put ASCII art here}

[Architecture diagram rendered via bonsai_visualize in chat]

---

## Source Tree

{Annotated directory tree generated from actual structure}

---

## Data Flow

{Best-effort data flow based on import analysis and type signatures}

---

## Key Components

| Module | Purpose | Key Files |
|--------|---------|-----------|
{Auto-generated from directory scan}

---

## Design Decisions

{TODO: Document rationale for key architectural choices}

---

## Sub-Module Documentation

| Module | README |
|--------|--------|
{Links to generated or existing module READMEs}
```

### Step 5: Generate Module Design skeletons

For each major module, generate a README.md:

```markdown
# {Module Name}

{Auto-generated description based on code analysis. Review and refine.}

## Public Interface

{Extracted from code:}
- **`{function_name}({params}) -> {return_type}`** — {inferred purpose from name/context}

## Output Contract

| Field | Type | Description |
|-------|------|-------------|
{Extracted from return types and public structs}

## Internal Organization

| File | Purpose |
|------|---------|
{Generated from file listing with inferred purposes}

## Key Design Decisions

{TODO: Document rationale — cannot be inferred from code alone}

## Known Limitations

{TODO: Document limitations}
```

### Step 6: Register generated specs

Add all generated specs to `.specs/registry.json` with status `"draft"`.

### Step 7: Report results

```
Specifications generated from code analysis:

Generated:
  DESIGN_DOC.md          architecture-design  (draft)
  src/module_a/README.md module-design         (draft)
  src/module_b/README.md module-design         (draft)
  ...

All specs marked as DRAFT — they need human review and refinement.
Key areas needing human input:
  - Design decisions and rationale (cannot be inferred from code)
  - Known limitations
  - Design philosophy
  - Pipeline diagrams (verify accuracy)

Suggested next steps:
  1. Review each generated spec and fill in TODOs
  2. Run /spec-lint to check structural completeness
  3. Run /spec-status to see overall coverage
```

## After Completion

Use AskUserQuestion:

**What's next?**
- "/spec-status — See coverage after generation (Recommended)"
- "/spec-review — Review generated specs for accuracy"
- "/spec-lint — Validate spec structure"
- "Done for now"

## Key Principles

- **Skeleton, not fiction**: Generate what can be reliably inferred. Mark everything else as TODO.
- **Never invent rationale**: Design decisions CANNOT be reverse-engineered — always mark them as TODO
- **Mark as draft**: All auto-generated specs get status "draft" until human review
- **Over-extract, don't under-extract**: Better to have too much in the skeleton than too little
- **Respect existing docs**: If a README already exists, don't overwrite — report it and suggest review instead
- **Use AskUserQuestion** for scope decisions and review confirmations
