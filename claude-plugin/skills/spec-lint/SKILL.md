---
name: spec-lint
description: Validate specification structure, links, completeness, and consistency. Use to check that specs follow templates and are internally consistent.
argument-hint: "[spec-path-or-directory]"
---

# Specification Linter

You are validating specifications for **structural quality, completeness, and consistency**. This is the automated quality gate for spec-driven development.

## IMPORTANT: Use Pre-Computed Data

Lint results are **pre-computed by the dashboard script**. Do NOT manually read all spec files.

## Process

### Step 1: Run the dashboard script

Execute:
```bash
python3 "$CLAUDE_PLUGIN_ROOT/tools/compute-dashboard.py" "$CLAUDE_PROJECT_DIR" --terminal lint
```

This outputs a formatted lint report including:
1. **Error/warning/fixable counts**
2. **Per-issue details** with severity, spec, and message
3. **Fixable items** clearly marked

### Step 2: Filter by path (if argument provided)

If the user specified a path, read `.specs/dashboard.json` and filter the `lint[]` array to show only issues matching that path or spec_id.

### Step 3: Deep analysis (optional)

For issues the script flags, you may need to read the specific spec file to understand the issue in context. Only read files the lint report flags -- don't scan everything.

### What Gets Checked

The script checks:

1. **Structural completeness** -- Required sections per spec type:
   - architecture-design: Table of Contents, High-Level Pipeline, Source Tree, Data Flow, Key Design Decisions
   - module-design: Table of Contents, Public Interface, Output Contract, Key Design Decisions, Known Limitations
   - task-spec: Context, Files, Definition of Done
   - goal-and-requirements: Goal, Business Requirements, Technical Requirements

2. **Registry consistency** -- Specs on disk vs registered entries

3. **Link validation** -- Broken cross-references between specs

4. **Freshness** -- Stale specs (code changed after spec)

### Step 4: Offer auto-fixes

For fixable issues, offer to:
- Register unregistered specs
- Update stale registry entries
- Remove broken links from registry

### Step 5: Offer next actions

Use AskUserQuestion:

**What's next?**
- "/spec-review -- Deep accuracy review of flagged specs (Recommended if errors found)"
- "/spec-next -- See what to specify next"
- "/spec-status -- Full coverage dashboard"
- "Done for now"

## Key Principles

- **Errors vs Warnings**: Missing required sections = WARNING. Missing files/broken links = ERROR.
- **Auto-fix safely**: Only offer to fix unambiguous issues (registry updates, not content)
- **Fast**: Pre-computed; only read individual files for deep analysis
- **Actionable**: Every issue includes what to do about it
