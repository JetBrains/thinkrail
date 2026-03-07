---
name: spec-status
description: Show specification coverage, health, and gaps for the current project. Use to check which modules have specs, which are stale, and what needs attention.
---

# Specification Status and Coverage Report

You are generating a **specification status report** for the current project. This is the dashboard for spec-driven development.

## IMPORTANT: Use Pre-Computed Data

The dashboard data is **pre-computed by a script**. Do NOT manually read registry.json or scan the codebase.

## Process

### Step 1: Run the dashboard script

Execute:
```bash
python3 "$CLAUDE_PLUGIN_ROOT/tools/compute-dashboard.py" "$CLAUDE_PROJECT_DIR" --terminal status
```

This outputs a fully formatted ANSI status report including:
1. **Coverage percentage** with progress bar
2. **Spec counts** (total, active, stale, draft)
3. **Task progress** bar
4. **Lint summary** (errors, warnings)
5. **Workflow steps** with status
6. **Top recommendations** prioritized by importance

### Step 2: For deeper analysis (optional)

If the user wants details on specific specs, coverage gaps, or freshness:

Read `.specs/dashboard.json` and examine:
- `coverage[]` -- per-directory spec coverage with freshness
- `lint[]` -- structural issues
- `recommendations[]` -- prioritized next actions
- `pending_tasks[]` -- remaining work items

This is ~5KB of pre-computed data vs reading the full registry (~68KB).

### Step 3: Offer actions

Use AskUserQuestion:

**What's next?**
- "/spec-next -- Get prioritized recommendations (Recommended)"
- "/spec-lint -- Validate spec structure"
- "/spec-from-code -- Generate specs for uncovered modules"
- "Done for now"

## Key Principles

- **Fast**: Script computes everything in ~150ms
- **Actionable**: Every issue has a suggested action with explicit `/skill-name`
- **Non-destructive**: Only reads and reports, never modifies code or specs
- **Colored output**: Script applies ANSI colors for dark theme automatically
