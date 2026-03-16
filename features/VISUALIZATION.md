# MCP Visualization — Feature Spec

> Parent: [VISUALIZATION_DESIGN.md](VISUALIZATION_DESIGN.md) | Status: **Active** | Created: 2026-03-16

## Table of Contents
1. [Summary](#summary)
2. [Tool Schema](#tool-schema)
3. [Visualization Types](#visualization-types)
4. [Validation](#validation)
5. [Layout Hints](#layout-hints)
6. [Status Values](#status-values)
7. [visId Collapse Pattern](#visid-collapse-pattern)
8. [Dual-Server Architecture](#dual-server-architecture)
9. [Backend](#backend)
10. [Frontend](#frontend)
11. [Context Integration](#context-integration)
12. [Scenarios](#scenarios)
13. [Related Specs](#related-specs)

## Summary

MCP Visualization provides structured visual output within agent chat sessions. The agent calls the `bonsai_visualize` MCP tool with typed data, and the frontend renders rich cards (progress trackers, tables, comparisons, diagrams, etc.) directly in the ChatStream.

Two deployment modes serve different environments:
- **SDK handler** (`visualization.py`) — in-process MCP tool for Bonsai web UI sessions; lightweight validation + confirmation text; actual rendering on frontend
- **CLI server** (`vis-server.py`) — standalone stdio MCP server for Claude Code CLI sessions; validates + renders Markdown fallback

Both share validation logic via `_vis_validation.py`.

## Tool Schema

The agent calls `bonsai_visualize` with:

```json
{
  "type": "progress-tracker",
  "title": "Implementation Progress",
  "visId": "impl-progress",
  "layout": { "width": "wide", "maxHeight": 400 },
  "data": {
    "steps": [
      { "label": "Parse input", "status": "done", "file": "parser.py" },
      { "label": "Validate schema", "status": "current" },
      { "label": "Generate output", "status": "pending" }
    ]
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `VisType` | yes | One of 6 visualization types |
| `title` | `string` | no | Card header title (defaults to `type`) |
| `visId` | `string` | no | Stable ID for auto-collapse of older cards with same visId |
| `layout` | `VisLayout` | no | Width hint + max height — frontend-interpreted |
| `data` | `object` | yes | Type-specific structured data |

## Visualization Types

### progress-tracker
Multi-step workflow with status indicators.

```json
{ "steps": [{ "label": "Step 1", "status": "done", "file": "foo.py", "substeps": [{ "label": "Sub 1", "status": "done" }] }] }
```

### summary-box
Structured key-value information grouped into sections.

```json
{ "sections": [{ "heading": "Config", "status": "done", "items": [{ "label": "Port", "value": "8000" }] }] }
```

### comparison
Side-by-side option evaluation with pros/cons. Each option can include an optional `visualization` field with Mermaid syntax to render an inline diagram.

```json
{ "options": [{ "name": "Option A", "description": "Fast", "pros": ["Simple"], "cons": ["Limited"], "visualization": "graph LR; A-->B" }] }
```

### data-table
Tabular data with optional status-colored column.

```json
{ "columns": ["File", "Status"], "rows": [["foo.py", "done"]], "statusColumn": 1 }
```

### status-list
Flat list of items with status badges.

```json
{ "items": [{ "label": "Config loaded", "status": "done", "meta": "0.3s" }] }
```

### diagram
Structured node/edge data or raw text. Structured diagrams render as Mermaid SVGs on the frontend. Text-based diagrams render as `<pre>` blocks unless `notation: "mermaid"` is specified, in which case they render as Mermaid SVGs with zoom controls.

Structured:
```json
{ "nodes": [{ "id": "a", "label": "Start" }], "edges": [{ "from": "a", "to": "b" }], "layout": "left-to-right" }
```

Text-based (plain):
```json
{ "diagram": "A --> B --> C" }
```

Text-based (Mermaid):
```json
{ "diagram": "graph LR\n  A --> B --> C", "notation": "mermaid" }
```

## Validation

Shared validation pipeline in `_vis_validation.py`, imported by both servers:

1. **JSON string guard** — if `data` is a string, attempt `json.loads()` (LLMs sometimes stringify objects)
2. **Type check** — `data` must be a dict
3. **Type-specific validation** — `_validate_vis_data()` checks required fields per type
4. **Status validation** — types with status fields (`progress-tracker`, `status-list`) validate against `VALID_STATUSES`

### Error response format

Both servers return the same structure on validation failure:

```
❌ Validation error for '{type}': {hint}

Expected format: {example}
```

The `isError: True` flag ensures the SDK relays the error to the LLM with a corrective example.

## Layout Hints

| Field | Values | Frontend behavior |
|-------|--------|------------------|
| `width` | `"compact"` / `"normal"` / `"wide"` | CSS class on `.vis-card` (`vis-card--compact`, none, `vis-card--wide`) |
| `maxHeight` | number (px) | Inline `max-height` + `overflow-y: auto` on `.vis-card-body` |

Layout is a pass-through on the backend — not validated or interpreted.

## Status Values

8 recognized values across the system:

| Status | Primary | Icon | Color |
|--------|---------|------|-------|
| `done` | Yes | ✓ | green |
| `current` | Yes | ▶ | blue |
| `pending` | Yes | ○ | hint (gray) |
| `error` | Yes | ✕ | red |
| `skipped` | Yes | ⊘ | hint (gray) |
| `stale` | Yes | ~ | gold |
| `fresh` | Compat | ✓ | green |
| `in_progress` | Compat | ◐ | blue |

`fresh` and `in_progress` are backward-compatible aliases — they render identically to `done` and `current` respectively. The 6 primary statuses are preferred.

## visId Collapse Pattern

When the agent sends multiple visualizations with the same `visId`:
1. ChatStream pre-scans all `toolCallStart` events to find the last occurrence per `visId`
2. Earlier cards render as `CollapsedVisMarker` — a compact one-line indicator (icon + title + "updated" tag)
3. The last card renders as a full `VisualizationCard`
4. Collapsed cards can be expanded by clicking

This lets the agent update a progress tracker repeatedly without flooding the chat.

## Dual-Server Architecture

```
┌─────────────────────────────────┐
│        _vis_validation.py       │  ← Single source of truth
│  VALID_STATUSES, VIS_EXAMPLES   │     (pure stdlib, zero deps)
│  _validate_status()             │
│  _validate_vis_data()           │
└──────────┬──────────┬───────────┘
           │          │
    ┌──────▼──┐  ┌────▼──────────┐
    │ vis.py  │  │ vis-server.py │
    │ (SDK)   │  │ (CLI stdio)   │
    │         │  │               │
    │ In-proc │  │ Standalone    │
    │ MCP     │  │ MCP server    │
    │ handler │  │ with MD       │
    │         │  │ renderers     │
    └─────────┘  └───────────────┘
```

### Why both exist

| Server | When used | Frontend | Rendering |
|--------|-----------|----------|-----------|
| `visualization.py` | Bonsai web UI sessions (SDK runner) | Yes — `toolCallStart` events rendered as `VisualizationCard` | Frontend-rendered rich cards |
| `vis-server.py` | Claude Code CLI sessions (MCP config) | No | Server-rendered Markdown tables/lists |

### How they share validation

`vis-server.py` uses a `sys.path.insert()` to import from the backend package without installing it. Both servers call the same `_validate_vis_data()` and use the same `VIS_EXAMPLES` for error messages.

## Backend

Backend implementation is self-contained in the `tools/` package. See [backend/app/agent/tools/VISUALIZATION.md](../backend/app/agent/tools/VISUALIZATION.md) for the backend-only spec.

**Summary:** `visualization.py` defines `VIS_SCHEMA`, `vis_mcp_server`, and `intercept_visualize()` (auto-approve). The handler validates input via shared `_validate_vis_data()` and returns a short confirmation. `_vis_validation.py` provides the shared validation. `vis-server.py` provides the CLI fallback with Markdown rendering.

## Frontend

Frontend implementation renders the cards in the ChatStream. See [frontend/ui-specs/VISUALIZATION_CARD.md](../frontend/ui-specs/VISUALIZATION_CARD.md) for the frontend-only spec.

**Summary:** `VisualizationCard.tsx` is the main component with 6 sub-renderers, `VisErrorBoundary`, `CollapsedVisMarker`, `StatusIcon`, and Mermaid diagram support. `vis.ts` defines the TypeScript types as a discriminated union on `type`. `mermaid.ts` provides shared Mermaid initialization. `ChatStream.css` contains all `.vis-card*` classes.

## Context Integration

The agent learns about `bonsai_visualize` through two channels:

1. **General Instructions** (`context.py`) — Every session's system prompt includes a Visualization subsection with available types, when-to-use guidance, and anti-patterns (no Bash/ANSI/ASCII art). See [CONTEXT.md](../backend/app/agent/CONTEXT.md).

2. **Skill SKILL.md files** — Individual skills may include visualization-specific templates (e.g., progress tracker JSON with the right "current" step for their workflow). General vis rules are now in General Instructions; skills only contain task-specific templates.

## Scenarios

### Basic call

```
Agent calls bonsai_visualize with type="summary-box", title="Module Overview"
  → Backend validates, returns "✓ Rendered: Module Overview (summary-box)"
  → SDK emits toolCallStart with toolInput containing the full vis data
  → Frontend renders VisualizationCard with SummaryBox sub-renderer
```

### visId update

```
Agent calls bonsai_visualize with visId="progress", step 1 current
  → Card rendered in full
Agent calls bonsai_visualize with visId="progress", step 2 current
  → First card auto-collapsed to one-line marker
  → Second card rendered in full
```

### Layout hints

```
Agent calls bonsai_visualize with layout={width: "wide", maxHeight: 300}
  → Card gets vis-card--wide class (full width)
  → Card body has max-height: 300px with scroll
```

### Validation error

```
Agent calls bonsai_visualize with type="data-table", data={columns: ["A"], rows: [["a", "b"]]}
  → Backend: row has 2 cells but 1 column → validation error
  → Returns isError with hint and example format
  → Agent self-corrects on next call
```

### Mermaid diagram (structured)

```
Agent calls bonsai_visualize with type="diagram", data={nodes: [...], edges: [...]}
  → Frontend converts to Mermaid syntax via toMermaidSyntax()
  → MermaidDiagram renders SVG with zoom controls asynchronously
  → On error: shows raw syntax as fallback
```

### Mermaid diagram (raw notation)

```
Agent calls bonsai_visualize with type="diagram", data={diagram: "graph LR; A-->B", notation: "mermaid"}
  → Frontend renders with MermaidDiagram (same as structured, with zoom)
  → On error: shows raw syntax as fallback
```

### Comparison with visualization

```
Agent calls bonsai_visualize with type="comparison", data={options: [{name: "A", visualization: "graph TD; X-->Y", ...}]}
  → Each option renders an inline MermaidDiagram between description and pros/cons
  → Zoom controls available on each diagram
```

## Related Specs

- **Parent:** [VISUALIZATION_DESIGN.md](VISUALIZATION_DESIGN.md) — architecture design doc
- **Backend:** [backend/app/agent/tools/VISUALIZATION.md](../backend/app/agent/tools/VISUALIZATION.md)
- **Frontend:** [frontend/ui-specs/VISUALIZATION_CARD.md](../frontend/ui-specs/VISUALIZATION_CARD.md)
- **Context:** [backend/app/agent/CONTEXT.md](../backend/app/agent/CONTEXT.md) — General Instructions includes vis rules
