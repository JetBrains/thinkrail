# Visualization Card — Frontend Spec

> Parent: [Chat UI](CHAT_UI.md) | Feature: [features/VISUALIZATION.md](../../features/VISUALIZATION.md) | Status: **Active** | Created: 2026-03-16

## Purpose

Frontend rendering layer for the `bonsai_visualize` MCP tool. Takes structured visualization data from `toolCallStart` events and renders rich interactive cards within the ChatStream. Supports 6 visualization types, visId-based auto-collapse, layout hints, Mermaid diagrams, and graceful error handling.

## Component Tree

```
VisErrorBoundary (class component — catches render errors)
  └── VisualizationCard (main component)
        ├── collapsed state → inline collapse bar (icon + title + "updated" tag)
        ├── invalid data guard → error card
        └── vis-card-body → type switch:
              ├── ProgressTracker
              ├── SummaryBox
              ├── Comparison
              │     └── opt.visualization? → MermaidDiagram (inline per option)
              ├── DataTable
              ├── StatusList
              └── Diagram
                    ├── text-based, notation=mermaid → MermaidDiagram (async render + zoom)
                    ├── text-based, plain → <pre> block
                    └── structured → MermaidDiagram (async render + zoom)

ZoomBar (shared component — utils/ZoomBar.tsx, used by MermaidDiagram and MarkdownPreview)
CollapsedVisMarker (standalone — used by ChatStream for visId pre-scan)
```

## TypeScript Types

All types are defined in `types/vis.ts`.

### Core types

| Type | Description |
|------|-------------|
| `VisStatus` | `"done" \| "current" \| "pending" \| "error" \| "skipped" \| "stale" \| "fresh" \| "in_progress"` |
| `VisType` | `"progress-tracker" \| "summary-box" \| "comparison" \| "data-table" \| "status-list" \| "diagram"` |
| `VisLayout` | `{ width?: "compact" \| "normal" \| "wide"; maxHeight?: number }` |
| `VisData` | Discriminated union on `type` — each variant includes `title?`, `visId?`, `layout?`, `data` |

### Per-type data interfaces

| Interface | Key fields |
|-----------|-----------|
| `ProgressTrackerData` | `steps: ProgressStep[]` — each has `label`, `status`, optional `file`, `substeps` |
| `SummaryBoxData` | `sections: SummarySection[]` — each has `heading`, optional `status`, `items[]` with `label`/`value` |
| `ComparisonData` | `options: ComparisonOption[]` — each has `name`, optional `description`, `pros[]`, `cons[]`, `visualization?` (Mermaid string) |
| `DataTableData` | `columns: string[]`, `rows: string[][]`, optional `statusColumn: number` |
| `StatusListData` | `items: StatusListItem[]` — each has `label`, `status`, optional `meta` |
| `DiagramData` | Union: `StructuredDiagramData` (`nodes[]`, `edges[]`, `layout?`) or `TextDiagramData` (`diagram: string`, `notation?: string`) |

## Status Rendering

### STATUS_ICONS

| Status | Icon |
|--------|------|
| `done` | ✓ |
| `current` | ▶ |
| `pending` | ○ |
| `error` | ✕ |
| `skipped` | ⊘ |
| `stale` | ~ |
| `fresh` | ✓ |
| `in_progress` | ◐ |

### STATUS_COLORS

Maps each status to a CSS variable: `done`/`fresh` → `--green`, `current`/`in_progress` → `--blue`, `pending`/`skipped` → `--hint`, `error` → `--red`, `stale` → `--gold`.

### StatusIcon component

```tsx
function StatusIcon({ status }: { status: VisStatus })
```

Renders a `<span>` with the icon character and color from the maps above. Used by `ProgressTracker`, `SummaryBox`, `StatusList`, and `DataTable` (via `statusColumn`).

## Sub-renderers

| Component | Renders | Notable behavior |
|-----------|---------|-----------------|
| `ProgressTracker` | Step list with status icons, optional file badges, nested substeps | Current step bolded; pending steps dimmed |
| `SummaryBox` | Sections with heading + key-value pairs | Optional status icon on section heading; empty state for no items |
| `Comparison` | Option cards with name, description, optional Mermaid diagram, pro/con lists | ✓/✗ icons colored green/red; optional `visualization` renders inline MermaidDiagram |
| `DataTable` | HTML `<table>` with thead/tbody | Optional `statusColumn` index colors cells by value |
| `StatusList` | Flat item list with status icons and optional meta | Meta rendered in parentheses, italicized |
| `Diagram` | Text-based (pre block or Mermaid via `notation`), or structured (Mermaid SVG) | `notation: "mermaid"` → MermaidDiagram; falls back to "No diagram data" empty state |

## Mermaid Integration

### `ensureMermaid()` — `utils/mermaid.ts`

Initializes Mermaid once with dark theme configuration matching the Bonsai UI (JetBrains Mono font, custom colors). Called before any diagram render. Shared by both `VisualizationCard` (diagrams) and `MarkdownPreview` (code fences).

### `toMermaidSyntax()` — exported from `VisualizationCard.tsx`

```typescript
function toMermaidSyntax(data: StructuredDiagramData): string
```

Converts structured `{nodes, edges, layout?}` into Mermaid flowchart syntax:
- `layout: "left-to-right"` → `graph LR`, default → `graph TD`
- Node labels escaped with `#quot;` for Mermaid compatibility
- Edge labels rendered with `-->|label|` syntax

### `MermaidDiagram` component

Async renders Mermaid SVG into a ref div with zoom controls (`ZoomBar`). Zoom range: 0.3×–3×, step 0.15. Controls appear on hover via `.vis-mermaid-wrapper:hover .vis-mermaid-zoom`. Handles errors gracefully — shows the error message plus raw syntax as fallback. SVG is resized to `width: 100%` for responsive layout.

### `ZoomBar` component — `utils/ZoomBar.tsx`

Reusable zoom UI with −/+/reset buttons. Shared by `MermaidDiagram` (in VisualizationCard) and `MermaidBlock`/`MarkdownPreview` (in FileViewer). Uses `.md-zoom-*` CSS classes from `FileViewer.css`.

## Layout Hints

The `layout` field from the tool input maps to CSS and inline styles:

| `layout.width` | CSS class | Effect |
|-----------------|-----------|--------|
| `"compact"` | `vis-card--compact` | Narrower card |
| `"normal"` | (none) | Default width |
| `"wide"` | `vis-card--wide` | Full-width card |

| `layout.maxHeight` | Inline style | Effect |
|---------------------|-------------|--------|
| Number (px) | `max-height: {n}px; overflow-y: auto` on `.vis-card-body` | Scrollable body |

## visId Collapse

When multiple tool calls share the same `visId`, earlier cards are collapsed. The logic lives in `ChatStream.tsx`:

1. **Pre-scan:** Before rendering, scan all `toolCallStart` events to find the last occurrence of each `visId`
2. **Collapsed prop:** Earlier occurrences get `collapsed={true}`, the last gets `collapsed={false}`
3. **Inline collapse:** The collapsed state renders as a compact one-line bar (icon + title + "updated" tag + expand arrow)
4. **Click to expand:** Clicking the collapsed bar toggles `isCollapsed` state to show the full card

### `CollapsedVisMarker`

Standalone component used by ChatStream when it needs to render a collapsed marker without the full card data:

```tsx
function CollapsedVisMarker({ title, type }: { title?: string; type?: string })
```

Renders the same compact one-line indicator as the collapsed `VisualizationCard`.

## Error Handling

### `VisErrorBoundary`

React class component wrapping each `VisualizationCard`. Catches render errors and displays an error card with red border and error message. Prevents malformed vis data from crashing the ChatStream.

### Invalid data guard

`VisualizationCard` checks `data?.type` and `data?.data` before rendering. If either is missing, renders an error card showing what's missing.

## Tests

| File | Covers |
|------|--------|
| `__tests__/VisualizationCard.test.tsx` | Component rendering, sub-renderers, collapsed state, error boundary |
| `__tests__/toMermaidSyntax.test.ts` | `toMermaidSyntax()` output for various node/edge configurations |

## Related Specs

- **Parent:** [Chat UI](CHAT_UI.md)
- **Feature:** [features/VISUALIZATION.md](../../features/VISUALIZATION.md)
- **Types:** `types/vis.ts`
- **Mermaid utils:** `utils/mermaid.ts`
- **CSS:** `ChatStream.css` (`.vis-card*`, `.vis-collapsed-marker*` classes)
