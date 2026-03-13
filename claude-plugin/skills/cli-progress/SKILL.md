---
name: cli-progress
description: Show and track specification-driven development progress. Displays phase progress, milestone completion, and workflow status using bonsai_visualize. Use at the beginning of any phase or to check overall progress.
---

# CLI Progress Tracker

You are the **progress tracker** for specification-driven development. You display rich progress visualizations at the beginning of each phase and on demand. This skill can be invoked directly or called by other skills.

## How It Works

### Step 1: Gather progress data

Read `.specs/registry.json` and scan `current_tasks/` to determine:
1. **Workflow steps** — which phases are done/current/pending
2. **Task counts** — total, done, in-progress, pending by module
3. **Spec coverage** — which modules have specs

### Step 2: Show workflow progress

Call `bonsai_visualize` with type `progress-tracker`:
```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "vizId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "done", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture", "status": "done", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs", "status": "done"},
      {"label": "Task Specs", "status": "current"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

Set each step's `status` based on what actually exists:
- `done` — file exists and is populated
- `current` — actively being worked on
- `pending` — not started yet

### Step 3: Show task summary (if tasks exist)

Call `bonsai_visualize` with type `summary-box`:
```json
{
  "type": "summary-box",
  "title": "Task Progress",
  "vizId": "task-progress",
  "data": {
    "sections": [
      {"heading": "Overview", "items": [
        {"label": "Total tasks", "value": "[count]"},
        {"label": "Completed", "value": "[count]"},
        {"label": "In progress", "value": "[count]"},
        {"label": "Pending", "value": "[count]"}
      ]},
      {"heading": "By Module", "items": [
        {"label": "[module1]", "value": "[X/Y done]"},
        {"label": "[module2]", "value": "[X/Y done]"}
      ]}
    ]
  }
}
```

### Step 4: Offer actions

Use AskUserQuestion:

**What's next?**
- "[Continue to next step] (Recommended)"
- "/spec-status — Detailed coverage report"
- "/visualisation — Full project dashboard"
- "Done for now"

## Key Principles

- **Always show context**: User should always know where they are in the workflow
- **Use `bonsai_visualize`**: All progress displays go through the visualization tool
- **Non-blocking**: Progress display should be quick and not interrupt workflow
- **Hook context**: When files are edited, the PostToolUse hook prints a one-liner summary automatically
