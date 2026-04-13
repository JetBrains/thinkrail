---
name: spec-init
description: Initialize a project for specification-driven development. Creates directory structure, registry, CLAUDE.md, and skeleton specifications. Use at the start of any new or existing project.
icon: "🔧"
group: Review
argument-hint: "[project-name]"
---

# Initialize Specification-Driven Development

You are setting up a project for **specification-driven development**. This is the first thing to run when starting a new project or adding specs to an existing one.

## What You Will Create

1. **Directory structure** for specifications
2. **Spec registry** (`.bonsai/registry.json`) for tracking all specs
3. **CLAUDE.md** with spec-driven development rules
4. **Skeleton specifications** to get started

## Step-by-Step Process

### Step 1: Assess the project

Use AskUserQuestion:

**Question 1 — Project state:**
- "New project (no code yet)" — Scaffold everything from scratch
- "Existing codebase" — Analyze code and generate spec skeletons

**Question 2 — Primary language:**
- "Rust" — Cargo.toml, src/, .rs files
- "TypeScript/JavaScript" — package.json, src/, .ts/.js files
- "Python" — setup.py/pyproject.toml, .py files
- (Other — let user specify)

If `$ARGUMENTS` is provided, use it as project name. Otherwise auto-detect from project files or ask.

### Step 2: Create directory structure

Create these directories (skip any that already exist):

```
.bonsai/                    # Spec tracking and registry
current_tasks/             # Active task specifications
```

### Step 3: Create the spec registry

Create `.bonsai/registry.json` with this initial structure:

```json
{
  "version": "2.0",
  "project": "{project-name}",
  "specs": [],
  "links": []
}
```

The registry schema:

**Spec entry:**
```json
{
  "id": "unique-id",
  "type": "goal-and-requirements|architecture-design|module-design|submodule-design|task-spec",
  "path": "relative/path/to/spec",
  "title": "Human-readable title",
  "status": "draft|active|stale|deprecated",
  "created": "ISO-date",
  "updated": "ISO-date",
  "covers": ["src/path/covered/"],
  "tags": []
}
```

**Link entry:**
```json
{
  "from": "spec-id",
  "to": "spec-id",
  "type": "parent|depends-on|references|implements"
}
```

### Step 4: Create CLAUDE.md

Create `.claude/CLAUDE.md` (if it doesn't exist) with the spec-driven development rules. Include:

```markdown
# {Project Name}

This project uses specification-driven development.

## Spec-Driven Rules
1. Check specs before implementing: read existing specs first
2. Create specs before code: use /spec-init, /module-design, etc.
3. Update specs with code: when code changes, update corresponding spec
4. Track progress: use /spec-status to check coverage

## Project Structure
{Brief description of the project and its main components}

## Active Tasks
See current_tasks/ for active work items.

## Specifications
Run /spec-status to see specification coverage.
```

### Step 5: Create skeleton specifications

**For new projects:**
- Use `spec_save` to create a minimal `README.md` with `type: "goal-and-requirements"`, `status: "draft"` (ask user to fill in details later)
- Use `spec_save` to create a minimal `DESIGN_DOC.md` skeleton with `type: "architecture-design"`, `status: "draft"` and TOC placeholders

**For existing projects:**
- Analyze the directory structure
- List all major modules found
- Generate a coverage report showing what needs specs
- Suggest running `/spec-from-code` for the most important modules

### Step 6: Register initial specs

The `spec_save` calls above already created the registry entries. Use `registry_mutate` to add any `parent` or `depends-on` links between the created specs.

### Step 7: Report and suggest next steps

Print a summary:
```
Spec-driven development initialized for {project-name}!

Created:
  .bonsai/registry.json     - Specification registry
  .claude/CLAUDE.md        - Development rules
  {other files created}

Specification coverage: {X}% ({N} specs for {M} modules)

Suggested workflow:
  1. /goal-and-requirements - Define goal and requirements (GOAL&REQUIREMENTS.md)
  2. /architecture-design   - Document the architecture
  3. /module-design         - Specify modules
  4. /task-spec             - Create implementation tasks
```

## After Completion

Use `SuggestSession` to propose the natural first step based on project state:
- **New projects** (no existing code): suggest a `goal-and-requirements` session.
- **Existing codebases**: suggest a `spec-from-code` session.

Then use `AskUserQuestion`:
- "/spec-status — Check current coverage"
- "Done for now"

## Key Principles

- **Non-destructive**: Never overwrite existing files — skip or merge
- **Minimal viable setup**: Create just enough to get started, not everything
- **Guide the user**: Always end with clear next steps using AskUserQuestion
- **Registry is truth**: Every spec file must be registered
