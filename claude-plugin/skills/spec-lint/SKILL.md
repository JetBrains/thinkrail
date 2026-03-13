---
name: spec-lint
description: Validate specification structure, links, completeness, and consistency. Use to check that specs follow templates and are internally consistent.
argument-hint: "[spec-path-or-directory]"
---

# Specification Linter

You are validating specifications for **structural quality, completeness, and consistency**. This is the automated quality gate for spec-driven development.

## Process

### Step 1: Gather data

Read `.specs/registry.json` for the full spec list and links. For each spec, read the first ~4KB to check for required sections per type. Validate that all link `from`/`to` IDs reference existing specs.

### Step 2: Display lint results using bonsai_visualize

Show the lint report using `bonsai_visualize` with type `data-table`:
```json
{
  "type": "data-table",
  "title": "Specification Lint Report",
  "vizId": "spec-lint-report",
  "data": {
    "columns": ["Severity", "Spec", "Issue", "Fixable"],
    "rows": [
      ["ERROR", "[spec-id]", "[message]", "yes/no"],
      ["WARNING", "[spec-id]", "[message]", "yes/no"]
    ]
  }
}
```

### Step 3: Filter by path (if argument provided)

If the user specified a path, filter the `lint[]` array to show only issues matching that path or spec_id.

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
- **Fast**: Read registry + spec headers; only read full files for deep analysis
- **Actionable**: Every issue includes what to do about it
