# MCP Visualization — Architecture Design

> Parent: [DESIGN_DOC.md](../DESIGN_DOC.md) | Status: **Active** | Created: 2026-03-11 | Updated: 2026-03-16

## Table of Contents
1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Visualization Types](#visualization-types)
4. [visId Collapse Pattern](#visid-collapse-pattern)
5. [Changes by Layer](#changes-by-layer)
6. [Key Design Decisions](#key-design-decisions)
7. [Relation to vis/ Module](#relation-to-vis-module)
8. [Feature & Frontend Specs](#feature--frontend-specs)

## Overview

MCP Visualization provides structured visual output within agent chat sessions. Instead of describing progress or data in plain text, the agent calls the `bonsai_visualize` MCP tool, which renders rich visual cards (progress trackers, tables, comparisons, etc.) directly in the ChatStream.

This is distinct from the `vis/` dashboard module — this feature is about **inline session visualizations** rendered as chat events, not the global spec-health dashboard.

## Architecture

```
Agent (LLM) calls bonsai_visualize MCP tool
  │
  ├── Mode A: Bonsai Web UI (SDK handler)
  │     ├── visualization.py validates input via _vis_validation.py
  │     ├── returns confirmation text to SDK
  │     ├── SDK emits toolCallStart event
  │     │     → runner.py maps to agent/toolCallStart notification
  │     │     → payload includes full toolInput with vis data
  │     └── Frontend: ChatStream renders VisualizationCard
  │           → discriminated union on data.type
  │           → 6 sub-renderers (one per vis type)
  │           → visId-based auto-collapse of older cards
  │
  └── Mode B: Claude Code CLI (stdio MCP server)
        ├── vis-server.py validates input via _vis_validation.py
        └── returns Markdown-rendered visualization
```

The agent sees `bonsai_visualize` as a regular MCP tool. In SDK mode, the backend handler is lightweight — actual rendering happens on the frontend. In CLI mode, the server renders Markdown fallback.

### MCP Server Setup

```python
# visualization.py (SDK in-process handler)
vis_mcp_server = create_sdk_mcp_server(name="bonsai-vis", tools=[_bonsai_visualize])
```

The MCP server is wired into the SDK runner alongside the Bonsai plugin tools. Visualization rules are injected into the system prompt via `context.py` General Instructions to teach the agent when and how to use the tool.

## Dual-Server Architecture

Visualization runs in two modes depending on the deployment context:

| Server | File | Context | Rendering |
|--------|------|---------|-----------|
| SDK handler | `backend/app/agent/tools/visualization.py` | Bonsai web UI sessions | Frontend-rendered rich cards |
| CLI server | `claude-plugin/tools/vis-server.py` | Claude Code CLI sessions | Server-rendered Markdown |

Both import from `_vis_validation.py` — the single source of truth for validation logic:

```
_vis_validation.py (pure stdlib)
    ├── visualization.py imports VALID_STATUSES, VIS_EXAMPLES, _validate_*
    └── vis-server.py   imports VALID_STATUSES, VIS_EXAMPLES, _validate_*
```

The CLI server additionally provides Markdown renderers (`MD_RENDERERS`) for each vis type, since there's no frontend to render cards. It implements the MCP protocol over stdio (JSON-RPC 2.0 with Content-Length framing).

## Visualization Types

| Type | Purpose | Data Shape |
|------|---------|------------|
| `progress-tracker` | Multi-step workflow with status indicators | `steps[]: { label, status, file?, substeps? }` |
| `summary-box` | Structured key-value information | `sections[]: { heading, status?, items[]: { label, value } }` |
| `comparison` | Side-by-side option evaluation | `options[]: { name, description?, pros?, cons?, visualization? }` |
| `data-table` | Tabular data with optional status column | `columns[], rows[][], statusColumn?` |
| `status-list` | Flat list of items with status badges | `items[]: { label, status, meta? }` |
| `diagram` | Structured or raw Mermaid graph | `nodes[], edges[], layout?` OR `diagram: string, notation?: "mermaid"` |

### Status Values

All types share a common `VisStatus` union with 6 primary statuses and 2 backward-compatible aliases:

```typescript
type VisStatus = "done" | "current" | "pending" | "error" | "skipped" | "stale" | "fresh" | "in_progress";
```

| Status | Primary? | Equivalent |
|--------|----------|------------|
| `done`, `current`, `pending`, `error`, `skipped`, `stale` | Yes | — |
| `fresh` | Compat | Same as `done` (icon ✓, color green) |
| `in_progress` | Compat | Same as `current` (icon ◐, color blue) |

Each status maps to an icon (`STATUS_ICONS`) and color (`STATUS_COLORS`) in `VisualizationCard.tsx`.

## visId Collapse Pattern

When the agent sends multiple visualizations with the **same `visId`**, earlier cards are auto-collapsed to reduce visual noise:

```
toolCallStart: { visId: "impl-progress", type: "progress-tracker", ... }  ← rendered as CollapsedVisMarker
toolCallStart: { visId: "impl-progress", type: "progress-tracker", ... }  ← rendered as full VisualizationCard
```

`CollapsedVisMarker` shows a compact one-line indicator with icon + title + "updated" tag. The last card with each `visId` stays expanded.

## Changes by Layer

### Backend

| File | Change |
|------|--------|
| `agent/tools/_vis_validation.py` | Shared validation: `VALID_STATUSES`, `VIS_EXAMPLES`, `_validate_status()`, `_validate_vis_data()` — pure stdlib |
| `agent/tools/visualization.py` | SDK handler: `VIS_SCHEMA`, `_bonsai_visualize()` handler, `vis_mcp_server`, `intercept_visualize()` |
| `claude-plugin/tools/vis-server.py` | CLI server: `TOOL_DEFINITION`, `STATUS_ICONS`, `MD_RENDERERS`, stdio MCP protocol |
| `agent/context.py` | General Instructions section includes visualization rules |
| `agent/runner.py` | Wires `vis_mcp_server` into SDK client via `tools.MCP_SERVERS` |

No changes to: `service.py`, `tracker.py`, `models.py`, `rpc/`.

### Frontend

| File | Change |
|------|--------|
| `types/vis.ts` | TypeScript types: `VisStatus`, `VisType`, `VisLayout`, `VisData` discriminated union, per-type data interfaces |
| `components/ChatStream/VisualizationCard.tsx` | Main component + 6 sub-renderers + `VisErrorBoundary` + `CollapsedVisMarker` + `MermaidDiagram` (with zoom) + `toMermaidSyntax()` |
| `utils/mermaid.ts` | Shared Mermaid initialization (`ensureMermaid()`) — used by VisualizationCard and MarkdownPreview |
| `utils/ZoomBar.tsx` | Reusable zoom controls with optional popout button — shared by MarkdownPreview and VisualizationCard |
| `components/FileViewer/FileViewer.css` | `.md-zoom-*` classes including `.md-zoom-sep` separator for popout button |
| `components/ChatStream/ChatStream.tsx` | Renders `VisualizationCard` for `toolCallStart` events where `toolName === "bonsai_visualize"` |
| `components/ChatStream/ChatStream.css` | `.vis-card`, `.vis-card-header`, `.vis-card-body`, layout classes (`--compact`, `--wide`), `.vis-collapsed-marker` |

### Tool Input Schema

```json
{
  "type": "object",
  "required": ["type", "data"],
  "properties": {
    "type": { "enum": ["progress-tracker", "summary-box", "comparison", "data-table", "status-list", "diagram"] },
    "title": { "type": "string" },
    "visId": { "type": "string" },
    "data": { "type": "object" },
    "layout": {
      "type": "object",
      "properties": {
        "width": { "enum": ["compact", "normal", "wide"] },
        "maxHeight": { "type": "number" }
      }
    }
  }
}
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| MCP tool (not canUseTool) | Visualization uses standard MCP tool protocol | Agent uses it like any tool; no special interception needed; standard tool_use events carry the data |
| Lightweight backend handler | Handler validates and returns confirmation text only | All rendering is client-side; backend is a pass-through |
| Discriminated union types | `VisData` switches on `type` field | Type-safe rendering; each sub-renderer only receives its expected data shape |
| visId auto-collapse | Same visId collapses older cards | Agent can update a progress tracker repeatedly without flooding the chat |
| VisErrorBoundary | React error boundary wrapping each card | Malformed vis data doesn't crash the entire ChatStream |
| Emoji icons per type | `VIS_ICONS` map in VisualizationCard | Quick visual identification without additional icon libraries |
| Popout via Blob URL | SVG opened in new tab via `URL.createObjectURL` | No server round-trip; self-contained HTML with matching dark theme; works offline |
| CSS resize: vertical | Native browser resize grip on diagram containers | Zero JS required; `overflow: hidden` already satisfied the prerequisite |

## Relation to vis/ Module

The codebase has two distinct visualization systems:

| System | Module | Purpose | Data Source |
|--------|--------|---------|-------------|
| **MCP Visualization** (this doc) | `agent/visualization.py` | Inline chat visualizations called by the agent during sessions | Agent decides what to visualize |
| **Vis Dashboard** | `vis/service.py`, `vis/models.py` | Global spec-health dashboard (coverage, tasks, lint) | Computed from registry + specs on disk |

They share no code. The vis/ dashboard is a pull/push state machine for spec metrics; MCP visualization is a tool the agent calls for rich chat output.

## Feature & Submodule Specs

| Component | Spec | Description |
|-----------|------|-------------|
| End-to-end feature | [features/VISUALIZATION.md](VISUALIZATION.md) | Full feature spec: schema, types, validation, dual-server, scenarios |
| Backend spec | [backend/app/agent/tools/VISUALIZATION.md](../backend/app/agent/tools/VISUALIZATION.md) | SDK handler, CLI server, shared validation |
| Frontend spec | [frontend/ui-specs/VISUALIZATION_CARD.md](../frontend/ui-specs/VISUALIZATION_CARD.md) | VisualizationCard components, types, Mermaid, layout hints |
| Vis dashboard module | [vis/README.md](../backend/app/vis/README.md) | Dashboard state computation (separate from MCP vis) |
| Frontend task | [feature_visualization_card.md](../current_tasks/frontend/feature_visualization_card.md) | VisualizationCard + sub-renderers + types |
