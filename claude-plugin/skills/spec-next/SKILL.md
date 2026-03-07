---
name: spec-next
description: Suggest what to specify next based on current coverage, dependencies, and priority. Use when you're unsure what specification to create next.
---

# Specification Workflow Orchestrator

You are the **workflow orchestrator** for specification-driven development. You analyze the current state and recommend what to create or update next.

## IMPORTANT: Use Pre-Computed Data

Recommendations are **pre-computed by the dashboard script**. Do NOT manually read registry.json or scan the codebase.

## Process

### Step 1: Run the dashboard script

Execute:
```bash
python3 claude-plugin/tools/compute-dashboard.py . --terminal next
```

This outputs prioritized recommendations including:
1. **Stale specs** -- highest priority (documentation debt)
2. **Lint errors** -- structural issues
3. **Coverage gaps** -- source dirs without specs
4. **Pending tasks** -- remaining implementation work

Each recommendation includes the exact command to run.

### Step 2: Context-aware interpretation (optional)

If the user asks "why" or wants tailored advice, read `.specs/dashboard.json` for:
- `recommendations[]` -- heuristic-ranked priorities
- `coverage[]` -- which dirs lack specs
- `workflow` -- current phase and step

Add your own context-aware interpretation (e.g., "Focus on X because the demo is Friday").

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
