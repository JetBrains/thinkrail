# MCP Visualization — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Visualization Types](#visualization-types)
4. [vizId Collapse Pattern](#vizid-collapse-pattern)
5. [Changes by Layer](#changes-by-layer)
6. [Key Design Decisions](#key-design-decisions)
7. [Relation to viz/ Module](#relation-to-viz-module)
8. [Feature & Frontend Specs](#feature--frontend-specs)

## Overview

MCP Visualization provides structured visual output within agent chat sessions. Instead of describing progress or data in plain text, the agent calls the `bonsai_visualize` MCP tool, which renders rich visual cards (progress trackers, tables, comparisons, etc.) directly in the ChatStream.

This is distinct from the `viz/` dashboard module — this feature is about **inline session visualizations** rendered as chat events, not the global spec-health dashboard.

## Architecture

```
Agent (LLM) calls bonsai_visualize MCP tool
  │
  ├── Backend: visualization.py handles the tool call
  │     → validates input against VIZ_SCHEMA
  │     → returns confirmation text to SDK
  │
  ├── SDK emits toolCallStart event
  │     → runner.py maps to agent/toolCallStart notification
  │     → payload includes full toolInput with viz data
  │
  └── Frontend: ChatStream renders VisualizationCard
        → discriminated union on data.type
        → 6 sub-renderers (one per viz type)
        → vizId-based auto-collapse of older cards
```

The agent sees `bonsai_visualize` as a regular MCP tool via `viz_mcp_server`. The backend handler is lightweight — actual rendering happens entirely on the frontend.

### MCP Server Setup

```python
# visualization.py
viz_mcp_server = create_mcp_server(
    tools=[{
        "name": "bonsai_visualize",
        "description": "Render structured visualization in the chat",
        "input_schema": VIZ_SCHEMA,
        "handler": _bonsai_visualize
    }]
)
```

The MCP server is wired into the SDK runner alongside the Bonsai plugin tools. `VIZ_INSTRUCTIONS` are injected into the system prompt via `context.py` to teach the agent when and how to use the tool.

## Visualization Types

| Type | Purpose | Data Shape |
|------|---------|------------|
| `progress-tracker` | Multi-step workflow with status indicators | `steps[]: { label, status, file?, substeps? }` |
| `summary-box` | Structured key-value information | `sections[]: { heading, status?, items[]: { label, value } }` |
| `comparison` | Side-by-side option evaluation | `options[]: { name, description?, pros?, cons? }` |
| `data-table` | Tabular data with optional status column | `columns[], rows[][], statusColumn?` |
| `status-list` | Flat list of items with status badges | `items[]: { label, status, meta? }` |
| `diagram` | Text-based graph with nodes and edges | `nodes[], edges[], layout?` |

### Status Values

All types share a common `VizStatus` union:

```typescript
type VizStatus = "done" | "current" | "pending" | "error" | "skipped" | "stale" | "fresh" | "in_progress";
```

Each status maps to an icon (`STATUS_ICONS`) and color (`STATUS_COLORS`) in `VisualizationCard.tsx`.

## vizId Collapse Pattern

When the agent sends multiple visualizations with the **same `vizId`**, earlier cards are auto-collapsed to reduce visual noise:

```
toolCallStart: { vizId: "impl-progress", type: "progress-tracker", ... }  ← rendered as CollapsedVizMarker
toolCallStart: { vizId: "impl-progress", type: "progress-tracker", ... }  ← rendered as full VisualizationCard
```

`CollapsedVizMarker` shows a compact one-line indicator with icon + title + "updated" tag. The last card with each `vizId` stays expanded.

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `agent/visualization.py` | New module: `VIZ_SCHEMA` (JSON schema), `VIZ_INSTRUCTIONS` (system prompt), `_bonsai_visualize()` handler, `viz_mcp_server` instance |
| `agent/context.py` | Injects `VIZ_INSTRUCTIONS` into system prompt assembly |
| `agent/runner.py` | Wires `viz_mcp_server` into SDK client as additional MCP server |

No changes to: `service.py`, `tracker.py`, `models.py`, `rpc/`.

### Frontend

| File | Change |
|------|--------|
| `types/viz.ts` | TypeScript types: `VizStatus`, `VizType`, `VizData` discriminated union, per-type data interfaces |
| `components/ChatStream/VisualizationCard.tsx` | Main component + 6 sub-renderers (`ProgressTracker`, `SummaryBox`, `Comparison`, `DataTable`, `StatusList`, `Diagram`) + `VizErrorBoundary` + `CollapsedVizMarker` |
| `components/ChatStream/ChatStream.tsx` | Renders `VisualizationCard` for `toolCallStart` events where `toolName === "bonsai_visualize"` |
| `components/ChatStream/ChatStream.css` | `.viz-card`, `.viz-card-header`, `.viz-card-body` and type-specific CSS classes |

### Tool Input Schema

```json
{
  "type": "object",
  "required": ["type", "data"],
  "properties": {
    "type": { "enum": ["progress-tracker", "summary-box", "comparison", "data-table", "status-list", "diagram"] },
    "title": { "type": "string" },
    "vizId": { "type": "string" },
    "data": { "type": "object" }
  }
}
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MCP tool (not canUseTool) | Visualization uses standard MCP tool protocol | Agent uses it like any tool; no special interception needed; standard tool_use events carry the data |
| Lightweight backend handler | Handler validates and returns confirmation text only | All rendering is client-side; backend is a pass-through |
| Discriminated union types | `VizData` switches on `type` field | Type-safe rendering; each sub-renderer only receives its expected data shape |
| vizId auto-collapse | Same vizId collapses older cards | Agent can update a progress tracker repeatedly without flooding the chat |
| VizErrorBoundary | React error boundary wrapping each card | Malformed viz data doesn't crash the entire ChatStream |
| Emoji icons per type | `VIZ_ICONS` map in VisualizationCard | Quick visual identification without additional icon libraries |

## Relation to viz/ Module

The codebase has two distinct visualization systems:

| System | Module | Purpose | Data Source |
|--------|--------|---------|-------------|
| **MCP Visualization** (this doc) | `agent/visualization.py` | Inline chat visualizations called by the agent during sessions | Agent decides what to visualize |
| **Viz Dashboard** | `viz/service.py`, `viz/models.py` | Global spec-health dashboard (coverage, tasks, lint) | Computed from registry + specs on disk |

They share no code. The viz/ dashboard is a pull/push state machine for spec metrics; MCP visualization is a tool the agent calls for rich chat output.

## Feature & Frontend Specs

| Component | Spec | Description |
|-----------|------|-------------|
| Viz dashboard module | [viz/README.md](../backend/app/viz/README.md) | Dashboard state computation (separate from MCP viz) |
| Frontend task | [feature_visualization_card.md](../current_tasks/frontend/feature_visualization_card.md) | VisualizationCard + sub-renderers + types |
