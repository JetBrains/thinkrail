---
name: visualisation
description: Utility skill for generating rich terminal visualizations in CLI. Provides patterns for ASCII diagrams, box formatting, progress indicators, architecture views, and side-by-side comparisons. Other skills reference this for consistent visual output.
---

# Terminal Visualisation Toolkit

You are a **visualization utility** for specification-driven development. Use these patterns whenever presenting information to the user in the CLI. All other skills should apply these patterns for consistent, clear visual output.

## IMPORTANT: When to Use

- This skill is invoked **automatically by other skills** when they need visualizations
- It can also be invoked **directly** to visualize existing specifications
- If invoked directly: run the dashboard script or open the HTML dashboard

## Direct Invocation

When invoked directly (`/specdriven:visualisation`):

### Option 1: Terminal dashboard

Execute:
```bash
python3 claude-plugin/tools/compute-dashboard.py . --terminal status
```

### Option 2: Browser dashboard

The HTML dashboard at `.specs/dashboard.html` provides an interactive view with:
- **Overview tab**: Workflow steps, recommendations
- **Graph tab**: Cytoscape.js interactive spec dependency graph
- **Specs tab**: Coverage table with freshness indicators
- **Tasks tab**: Task status by module
- **Lint tab**: Structural issues

Tell the user to open `.specs/dashboard.html` in their browser. It auto-refreshes every 3 seconds.

### Step 3: Offer actions

Use AskUserQuestion:

**What would you like to visualize?**
- "Open browser dashboard" -- Open .specs/dashboard.html
- "Terminal status report" -- Run --terminal status
- "Terminal progress" -- Run --terminal progress
- "Done"

## Rendering Guide

Output as **plain text and markdown** — do not use ANSI escape codes or `printf`. Use markdown formatting (bold, code spans, tables, fenced code blocks) for emphasis. The ASCII symbol patterns below work well and should be used for structured output.

## Visualization Patterns

These patterns remain available for skills that generate custom output:

### Box Formatting

**Double-line box** (summaries):
```
╔════════════════════════════════╗
║ TITLE                          ║
╠════════════════════════════════╣
║ Content                        ║
╚════════════════════════════════╝
```

**Single-line box** (progress):
```
┌───────────────────────────────┐
│ Title                         │
├───────────────────────────────┤
│ Content                       │
└───────────────────────────────┘
```

### Progress Bars

```
[████████░░░░░░░░] 8/14 tasks (57%)
```

Construction: `█` filled, `░` empty, 16 chars wide.

### Status Indicators

| Symbol | Meaning |
|--------|---------|
| `[✓]` | Completed |
| `[⊘]` | Skipped |
| ` ▶ ` | Current |
| `[ ]` | Pending |
| `[✗]` | Failed |
| `[~]` | Partial |

### Architecture Diagrams

```
┌──────────────┐
│ Component A  ├──────>┌──────────────┐
└──────┬───────┘       │ Component B  │
       │               └──────────────┘
       ↓
┌──────────────┐
│ Component C  │
└──────────────┘
```

### Side-by-Side Comparison

```
#1 [Approach Name]          ║  #2 [Approach Name]
                            ║
[diagram 1]                 ║  [diagram 2]
```

## Key Principles

- **Consistency**: Same symbols and patterns across all skills
- **Clarity**: Visualizations make complex information easier to understand
- **Brevity**: Keep diagrams focused
- **Accessibility**: ASCII art readable in any terminal
