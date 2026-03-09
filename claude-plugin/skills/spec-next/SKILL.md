---
name: spec-next
description: Suggest what to specify next based on current coverage, dependencies, and priority. Use when you're unsure what specification to create next.
---

# Specification Workflow Orchestrator

You are the **workflow orchestrator** for specification-driven development. You analyze the current state and recommend what to create or update next.

## IMPORTANT: Visualization Rules

**NEVER** output ASCII box-drawing characters or ANSI escape codes. Always use `bonsai_visualize` to display results.

## Process

### Step 1: Gather data

Read `.specs/registry.json` for specs (type, status, covers, paths). Scan `current_tasks/**/*.md` for task statuses. Identify coverage gaps by comparing registered `covers` entries against source directories.

### Step 2: Display recommendations using bonsai_visualize

Show recommendations using `bonsai_visualize` with type `status-list`:
```json
{
  "type": "status-list",
  "title": "Recommended Next Actions",
  "vizId": "spec-next-recommendations",
  "data": {
    "items": [
      {"label": "[Action 1]", "status": "error", "detail": "[Why this is highest priority]"},
      {"label": "[Action 2]", "status": "current", "detail": "[Reason]"},
      {"label": "[Action 3]", "status": "pending", "detail": "[Reason]"}
    ]
  }
}
```

### Step 3: Context-aware interpretation (optional)

If the user asks "why" or wants tailored advice, add your own context-aware interpretation (e.g., "Focus on X because the demo is Friday").

### Step 3: Offer to act

Use AskUserQuestion with the top recommendations:

**What should we work on?**
- "{Top recommendation} (Recommended)"
- "{Second recommendation}"
- "{Third recommendation}"
- "Nothing for now"

## Priority Rules (encoded in script)

1. **Missing foundation**: No registry -> `/spec-init`
2. **Missing goal & requirements**: No GOAL&REQUIREMENTS.md -> `/goal-and-requirements`
3. **Missing architecture**: No DESIGN_DOC.md -> `/architecture-design`
4. **Stale specs**: Code changed since spec update -> `/spec-review`
5. **Lint errors**: Structural issues -> `/spec-lint`
6. **Coverage gaps**: Code without specs -> `/module-design` or `/spec-from-code`
7. **Pending tasks**: Implementation work remaining

## Key Principles

- **Always actionable**: Every recommendation includes the exact command to run
- **Respect dependencies**: Don't suggest advanced specs before foundations are done
- **Stale > Missing**: Updating stale specs is more important than creating new ones
- **Explain why**: Each recommendation includes the reason it's prioritized
