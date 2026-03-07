---
name: cli-progress
description: Show and track specification-driven development progress. Displays phase progress, milestone completion, and workflow status with rich terminal visualizations. Use at the beginning of any phase or to check overall progress.
---

# CLI Progress Tracker

You are the **progress tracker** for specification-driven development. You display rich progress visualizations at the beginning of each phase and on demand.

## IMPORTANT: Interaction Style

- This skill can be invoked directly or called by other skills
- When invoked, run the dashboard script for terminal output, then offer next actions
- Use the **AskUserQuestion** tool to offer next actions

## How It Works

The progress display is **computed by a script** — no need to read registry.json or scan files manually.

### Step 1: Run the dashboard script

Execute:
```bash
python3 "$CLAUDE_PLUGIN_ROOT/tools/compute-dashboard.py" "$CLAUDE_PROJECT_DIR" --terminal progress
```

This outputs a fully formatted ANSI progress display including:
1. **Workflow steps** with completion status
2. **Overall task progress** bar
3. **Pending tasks** by module

### Step 2: For deeper analysis (optional)

If the user asks "why" or wants details beyond what the script shows, read `.specs/dashboard.json` (~5KB summary) instead of registry.json (~68KB). The dashboard.json contains pre-computed coverage, freshness, lint, and recommendations.

### Step 3: Offer actions

Use AskUserQuestion:

**What's next?**
- "[Continue to next step] (Recommended)"
- "/spec-status -- Detailed coverage report"
- "/visualisation -- Full project dashboard"
- "Done for now"

## Key Principles

- **Zero manual file scanning**: The script does all computation
- **Always show context**: User should always know where they are in the workflow
- **Non-blocking**: Progress display should be quick and not interrupt workflow
- **Persistent**: Progress is tracked in `.specs/.progress.json` across sessions
- **Hook context**: When files are edited, the PostToolUse hook prints a one-liner summary automatically
