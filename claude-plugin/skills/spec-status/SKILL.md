---
name: spec-status
description: Show specification coverage, health, and gaps for the current project. Use to check which modules have specs, which are stale, and what needs attention.
---

# Specification Status and Coverage Report

You are generating a **specification status report** for the current project. This is the dashboard for spec-driven development.

## Process

### Step 1: Gather data

Read `.specs/registry.json` to get the list of specs (with type, status, covers, paths). Then scan `current_tasks/**/*.md` for task statuses. Use file mtimes to determine freshness (compare spec mtime vs covered code mtime).

### Step 2: Display using bonsai_visualize

Show the status report using `bonsai_visualize` with type `summary-box`:
```json
{
  "type": "summary-box",
  "title": "Specification Status Report",
  "vizId": "spec-status",
  "data": {
    "sections": [
      {"heading": "Coverage", "items": [
        {"label": "Specs", "value": "[total] total, [active] active, [stale] stale, [draft] draft"},
        {"label": "Coverage", "value": "[X]%"}
      ]},
      {"heading": "Tasks", "items": [
        {"label": "Progress", "value": "[done]/[total] complete"},
        {"label": "Pending", "value": "[count] remaining"}
      ]},
      {"heading": "Lint", "items": [
        {"label": "Errors", "value": "[count]"},
        {"label": "Warnings", "value": "[count]"}
      ]},
      {"heading": "Top Recommendations", "items": [
        {"label": "1", "value": "[recommendation]"},
        {"label": "2", "value": "[recommendation]"}
      ]}
    ]
  }
}
```

### Step 3: For deeper analysis (optional)

If the user wants details on specific specs, coverage gaps, or freshness, show additional breakdowns using `bonsai_visualize` `data-table` type:
```json
{
  "type": "data-table",
  "title": "Spec Coverage by Module",
  "vizId": "spec-coverage-detail",
  "data": {
    "columns": ["Module", "Spec", "Status", "Freshness"],
    "rows": [["[module]", "[spec path]", "[status]", "[fresh/stale]"]]
  }
}
```

### Step 3: Offer actions

Use AskUserQuestion:

**What's next?**
- "/spec-next -- Get prioritized recommendations (Recommended)"
- "/spec-lint -- Validate spec structure"
- "/spec-from-code -- Generate specs for uncovered modules"
- "Done for now"

## Key Principles

- **Fast**: Read registry.json + task files, compute metrics directly
- **Actionable**: Every issue has a suggested action with explicit `/skill-name`
- **Non-destructive**: Only reads and reports, never modifies code or specs
- **Visual**: Always display results via `bonsai_visualize`, never ASCII art
