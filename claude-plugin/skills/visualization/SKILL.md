---
name: visualization
description: Utility skill for generating rich visualizations using the bonsai_visualize MCP tool. Provides patterns for progress trackers, summary boxes, comparisons, data tables, status lists, and diagrams. Other skills reference this for consistent visual output.
---

# Visualization Toolkit

You are a **visualization utility** for specification-driven development. Use the `bonsai_visualize` MCP tool for all structured visual output. All other skills should apply these patterns for consistent, clear visualizations.

## When to Use

- This skill is invoked **automatically by other skills** when they need visualizations
- It can also be invoked **directly** to visualize existing specifications
- If invoked directly: use `registry_query` and `spec_list` to gather data, then visualize

## Direct Invocation

When invoked directly (`/specdriven:visualization`):

### Step 1: Gather data

Use `registry_query` for spec metadata and `spec_list` with `type: "task-spec"` for task status. Compute:
- Workflow step completion (goal, architecture, modules, tasks)
- Task counts by status and module
- Spec coverage and freshness

### Step 2: Show dashboard

Call `bonsai_visualize` with a `summary-box` showing the overall project status:
```json
{
  "type": "summary-box",
  "title": "Project Dashboard",
  "visId": "project-dashboard",
  "data": {
    "sections": [
      {"heading": "Workflow Progress", "status": "current", "items": [
        {"label": "Goal & Requirements", "value": "[status]"},
        {"label": "Architecture", "value": "[status]"},
        {"label": "Module Specs", "value": "[X/Y complete]"},
        {"label": "Task Specs", "value": "[X/Y complete]"}
      ]},
      {"heading": "Task Summary", "items": [
        {"label": "Total", "value": "[count]"},
        {"label": "Done", "value": "[count]"},
        {"label": "In Progress", "value": "[count]"},
        {"label": "Pending", "value": "[count]"}
      ]}
    ]
  }
}
```

### Step 3: Offer actions

Use AskUserQuestion:

**What would you like to visualize?**
- "Detailed task breakdown by module"
- "Spec coverage report"
- "Workflow progress tracker"
- "Done"

## Visualization Types Reference

Call `bonsai_visualize` with the appropriate type:

### 1. `progress-tracker` — Workflow steps with status

```json
{
  "type": "progress-tracker",
  "title": "Specification-Driven Development",
  "visId": "workflow-progress",
  "data": {
    "steps": [
      {"label": "Goal & Requirements", "status": "done", "file": "GOAL&REQUIREMENTS.md"},
      {"label": "Architecture", "status": "current", "file": "DESIGN_DOC.md"},
      {"label": "Module Specs", "status": "pending"},
      {"label": "Task Specs", "status": "pending"},
      {"label": "Implementation", "status": "pending"}
    ]
  }
}
```

### 2. `summary-box` — Key-value data in sections

```json
{
  "type": "summary-box",
  "title": "Requirements Summary",
  "visId": "requirements-summary",
  "data": {
    "sections": [
      {"heading": "Business Requirements", "status": "done", "items": [
        {"label": "Auth system", "value": "JWT-based authentication"},
        {"label": "API", "value": "RESTful endpoints"}
      ]},
      {"heading": "Technology Stack", "status": "current", "items": [
        {"label": "Language", "value": "Python 3.11+"},
        {"label": "Framework", "value": "FastAPI"}
      ]}
    ]
  }
}
```

### 3. `comparison` — Side-by-side option comparison

Options can include an optional `visualization` field with Mermaid syntax to illustrate each approach visually.

```json
{
  "type": "comparison",
  "title": "Architecture Approaches",
  "visId": "arch-comparison",
  "data": {
    "options": [
      {
        "name": "Pipeline",
        "description": "Data flows through sequential stages",
        "visualization": "graph LR\n  A[Input] --> B[Process] --> C[Output]",
        "pros": ["Simple to understand", "Easy to test"],
        "cons": ["Less flexible", "Sequential bottleneck"]
      },
      {
        "name": "Event-driven",
        "description": "Components react to events",
        "visualization": "graph TD\n  A[Event Bus] --> B[Handler 1]\n  A --> C[Handler 2]",
        "pros": ["Highly decoupled", "Scalable"],
        "cons": ["Complex debugging", "Eventual consistency"]
      }
    ]
  }
}
```

### 4. `data-table` — Tabular data (coverage, tasks)

```json
{
  "type": "data-table",
  "title": "Spec Coverage",
  "visId": "spec-coverage",
  "data": {
    "columns": ["Module", "Spec", "Status", "Freshness"],
    "rows": [
      ["agent/", "README.md", "active", "fresh"],
      ["core/", "README.md", "active", "stale"],
      ["rpc/", "—", "missing", "—"]
    ]
  }
}
```

### 5. `status-list` — Vertical list with status icons

```json
{
  "type": "status-list",
  "title": "Module Status",
  "visId": "module-status",
  "data": {
    "items": [
      {"label": "agent/runner.py", "status": "done", "meta": "All tests passing"},
      {"label": "rpc/server.py", "status": "current", "meta": "In progress"},
      {"label": "core/watcher.py", "status": "pending", "meta": "Not started"}
    ]
  }
}
```

### 6. `diagram` — Component boxes and connections

Structured format (nodes/edges — recommended for most use cases):
```json
{
  "type": "diagram",
  "title": "System Architecture",
  "visId": "system-diagram",
  "data": {
    "nodes": [
      {"id": "frontend", "label": "Frontend (React)", "status": "done"},
      {"id": "rpc", "label": "RPC Server", "status": "current"},
      {"id": "agent", "label": "Agent Runner", "status": "done"},
      {"id": "spec", "label": "Spec Service", "status": "done"}
    ],
    "edges": [
      {"from": "frontend", "to": "rpc", "label": "WebSocket"},
      {"from": "rpc", "to": "agent", "label": "JSON-RPC"},
      {"from": "rpc", "to": "spec", "label": "JSON-RPC"}
    ]
  }
}
```

Raw Mermaid syntax (use when Mermaid features like subgraphs, styling, or sequence diagrams are needed):
```json
{
  "type": "diagram",
  "title": "Data Flow",
  "visId": "data-flow",
  "data": {
    "diagram": "graph LR\n  A[Input] --> B[Parser]\n  B --> C[Engine]\n  C --> D[Output]",
    "notation": "mermaid"
  }
}
```

## Status Values

| Status | Icon | Meaning |
|--------|------|---------|
| `done` | ✓ | Completed |
| `current` | ▶ | In progress |
| `pending` | ○ | Not started |
| `error` | ✗ | Failed |
| `skipped` | ⊘ | Intentionally skipped |
| `stale` | ~ | Outdated |

## Using `visId` for Updates

When a visualization has a `visId`, subsequent calls with the same `visId` will **update** the existing card in the UI instead of creating a new one. Use this for:
- Progress trackers that advance through steps
- Summary boxes that fill in as data is gathered
- Any visualization that changes over time during a session

## For Inline Text (simple cases only)

Use Markdown formatting:
- **Bold** for emphasis
- `code` for file paths, tool names
- Tables for structured data
- Blockquotes for callouts

## Key Principles

- **Structured data over text**: Describe WHAT to show, let the UI decide HOW
- **Use `bonsai_visualize` for all structured displays**: Never fall back to ASCII art
- **Consistency**: Same status values and types across all skills
- **Clarity**: Visualizations make complex information easier to understand
- **Brevity**: Keep data focused
