---
name: spec-status
description: Show specification coverage, health, and gaps for the current project. Use to check which modules have specs, which are stale, and what needs attention.
---

# Specification Status and Coverage Report

You are generating a comprehensive **specification status report** for the current project. This is the dashboard for spec-driven development.

## What You Will Do

1. **Read the registry** at `.specs/registry.json`
2. **Scan the codebase** to find all modules and source directories
3. **Cross-reference** specs against code to find gaps
4. **Check freshness** of each spec vs its covered code
5. **Validate links** between specs
6. **Generate a report**

## Process

### Step 1: Read the spec registry

Read `.specs/registry.json`. If it doesn't exist, suggest running `/spec-init` first.

### Step 2: Scan the codebase

Use Glob/Bash to find:
- All source directories (that contain code files)
- All existing README.md and documentation files
- All task/idea/project files

### Step 3: Build coverage map

For each source directory, check if there's a corresponding spec entry in the registry. Build a table:

```
Module/Directory          Spec Status    Last Updated    Freshness
─────────────────────────────────────────────────────────────────
README.md                 active         2026-02-11      fresh
DESIGN_DOC.md             active         2026-02-11      fresh
src/frontend/             active         2026-02-10      stale (code changed 02-11)
src/backend/              missing        —               —
src/common/               draft          2026-02-09      stale
current_tasks/            3 tasks        —               —
```

### Step 4: Check spec freshness

For each spec that covers a source directory:
- Get the spec's last modified time
- Get the most recent modification time of any code file in the covered directory
- If code is newer than spec → mark as **stale**
- If spec is newer or same → mark as **fresh**

### Step 5: Validate links

Check that:
- All `parent` links point to existing specs
- All `child` links are reciprocated
- All `depends-on` targets exist
- All referenced file paths exist on disk

### Step 6: Generate the report

Use rich terminal visualization (from `/specdriven:visualisation` patterns):

```
╔════════════════════════════════════════════════════════╗
║ SPECIFICATION STATUS REPORT                            ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║ Coverage: [██████░░░░] 60% (6/10 modules)              ║
║                                                        ║
║ Specs:  Total: {N}  Active: {N}  Stale: {N}  Draft: {N}║
║ Tasks:  Active: {N}  Completed: {N}  Pending: {N}      ║
║                                                        ║
║ Goal & Requirements: [✓] Defined / [ ] Missing         ║
║                                                        ║
╚════════════════════════════════════════════════════════╝
```

Then output the detailed markdown report:

```markdown
# Specification Status Report
Generated: {date}

## Summary
- Total specs: {N}
- Coverage: {X}% of source directories have specs
- Fresh: {N} | Stale: {N} | Missing: {N} | Draft: {N}

## Coverage Map

| Path | Spec Type | Status | Freshness |
|------|-----------|--------|-----------|
| GOAL&REQUIREMENTS.md | goal-and-requirements | active | fresh |
| DESIGN_DOC.md | architecture-design | active | fresh |
| src/parser/ | module-design | active | stale |
| src/lexer/ | — | MISSING | — |
| ... | ... | ... | ... |

## Stale Specs (need update)
{List of specs where code has been modified since the spec was last updated}

## Missing Specs (gaps)
{List of source directories with no corresponding specification}

## Broken Links
{Any spec cross-references that point to non-existent files or specs}

## Work Items
- Tasks: {N} active, {N} completed

## Recommended Actions
1. {Most important action — e.g., "Update stale spec for src/parser/"}
2. {Next action — e.g., "Create missing spec for src/lexer/"}
3. {Next action}
```

### Step 7: Update the registry

If you discovered specs on disk that aren't in the registry, offer to add them.
If you found registry entries for specs that no longer exist, offer to remove them.

## After Completion

Use AskUserQuestion:

**What's next?**
- "/spec-next — Get prioritized recommendations (Recommended)"
- "/spec-lint — Validate spec structure"
- "/spec-from-code — Generate specs for uncovered modules"
- "Done for now"

## Key Principles

- **Fast**: This should complete quickly — scan, don't deeply read every file
- **Actionable**: Every issue should have a suggested action with explicit `/skill-name`
- **Non-destructive**: Only reads and reports, never modifies code or specs (unless updating registry)
- **Always suggest next steps**: End with prioritized recommendations as explicit skill commands
- **Colored output**: Apply colors from the `/specdriven:visualisation` Color Output Guide when rendering (ANSI codes for dark theme)
