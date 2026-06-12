---
name: spec-lint
description: Validate specification structure, links, completeness, and consistency. Use to check that specs follow templates and are internally consistent.
icon: "📝"
group: Review
argument-hint: "[spec-path-or-directory]"
---

# Specification Linter

You are validating specifications for **structural quality, completeness, and consistency**. This is the automated quality gate for spec-driven development.

## Process

### Step 1: Gather data

Use `spec_search` for the full spec list. Use `spec_links` to get all links and validate that all `from`/`to` IDs reference existing specs. For each spec, use `Read` to read the content and check for required sections per type.

### Step 2: Display lint results using thinkrail_visualize

Show the lint report using `thinkrail_visualize` with type `data-table`:
```json
{
  "type": "data-table",
  "title": "Specification Lint Report",
  "visId": "spec-lint-report",
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

For issues flagged above, use `Read` to read the specific spec file and understand the issue in context. Only read specs the lint report flags — don't scan everything.

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

For fixable issues, use `Edit` to update the frontmatter:
- Add missing frontmatter fields to unregistered specs
- Update stale frontmatter fields (e.g. status)
- Remove broken link references from frontmatter

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
- **Fast**: Use `spec_search` + `spec_links` for overview; only use `Read` for deep analysis
- **Actionable**: Every issue includes what to do about it
