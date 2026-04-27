---
id: graph-interactions
type: submodule-design
status: active
title: Graph Interactions
parent: webview
depends-on:
- module-spec
covers:
- frontend/src/components/GraphView/
tags:
- frontend
- ui
- graph
- visualization
---
# Graph Interactions — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §4.1 | Status: **Active** | Created: 2026-03-02 | Updated: 2026-03-05

## Overview

The Graph view renders the spec hierarchy as an interactive layered SVG visualization in the right panel. It receives a `SpecGraph` (nodes + edges) from the backend via the `spec/graph` RPC call and displays one "layer" at a time — root nodes or the direct children of a selected root — with drill-down navigation and a breadcrumb trail.

Items not yet implemented are marked **[Planned]**.

---

## Data Model

TypeScript interfaces in `frontend/src/types/spec.ts`:

```typescript
interface RegistryEntry {
  id: string;
  type: string;   // "goal-and-requirements" | "architecture-design" | "module-design" | "submodule-design" | "task-spec"
  path: string;
  title: string;
  status: string; // "done" | "active" | "pending" | "waiting" | "stale" | "draft"
  covers: string[];
  tags: string[];
  created: string;
  updated: string;
}

interface Link {
  from: string;   // child, dependent, or implementor
  to: string;     // parent, dependency target, or implemented spec
  type: string;   // "parent" | "depends-on" | "implements" | "references"
}

interface SpecGraph {
  nodes: RegistryEntry[];
  edges: Link[];
}
```

**Edge direction convention:**
- `parent`: `from` is child, `to` is parent
- `implements`: `from` is task, `to` is spec it implements
- `depends-on`: `from` depends on `to`
- `references`: `from` references `to`

Only `parent` and `implements` edges define the drill hierarchy.

---

## 1. Rendering Approach: SVG

The graph canvas is a single `<svg>` element. Nodes are SVG `<g>` elements containing `<rect>`, `<line>`, and `<text>`. Edges are SVG `<line>` elements. Pan/zoom via a single SVG `<g transform="translate(Tx,Ty) scale(S)">`.

**Layout constants** (from `graphLayout.ts`):

```typescript
export const NODE_WIDTH  = 160;
export const NODE_HEIGHT = 38;
export const H_GAP       = 30;
export const V_GAP       = 50;
export const PADDING     = 20;
```

---

## 2. Component Hierarchy

```
frontend/src/components/GraphView/
  GraphView.tsx          // top-level, orchestrates sub-components
  GraphCanvas.tsx        // SVG canvas with pan/zoom transform group
  GraphNode.tsx          // SVG <g> for a single spec node
  EdgeLayer.tsx          // SVG <g> for all visible edges + arrowhead <defs>
  GraphBreadcrumb.tsx    // DOM breadcrumb bar (above canvas)
  GraphControls.tsx      // DOM zoom controls (absolute bottom-right)
  GraphLegend.tsx        // DOM legend (absolute bottom-left)
  graphLayout.ts         // pure layout functions
  GraphView.css          // all CSS
```

**Component tree:**

```
<GraphView>                        // .graph-view (flex column, relative)
  <GraphBreadcrumb>                // shown only when trail.length > 0
    <button.graph-breadcrumb-back> // ← back button
    <span> per ancestor
      <span.graph-breadcrumb-sep>  // ›
      <button.graph-breadcrumb-item>
    <span.graph-breadcrumb-current>
  <GraphCanvas>                    // <svg class="graph-canvas">
    <g transform="translate/scale">
      <EdgeLayer>                  // <g class="edge-layer">
        <defs><marker id="arrowhead">
        <line /> ...
      <GraphNode /> ...            // <g class="graph-node">
  <GraphControls>                  // .graph-controls (absolute bottom-right)
    <button> + / zoom% / − / ⊙
  <GraphLegend>                    // .graph-legend (absolute bottom-left)
```

---

## 3. Layer Computation

### 3.1 Structural Children

A node `C` is a structural child of `P` if there is an edge `{ from: C, to: P, type: "parent" | "implements" }`.

### 3.2 Finding Roots

Root nodes have no outgoing `parent` or `implements` edges.

### 3.3 Visible Layer

```typescript
interface LayerView {
  root: RegistryEntry | null;   // null at top level
  children: RegistryEntry[];
  intraEdges: Link[];           // edges between visible nodes only
  breadcrumb: RegistryEntry[];  // ancestor path
}
```

### 3.4 Breadcrumb Construction

Walks parent edges from current node to root, building an ancestor trail. Breadcrumb bar hidden at top level.

---

## 4. Layout Algorithm

### 4.1 Rank-Based Row Layout

Nodes grouped by spec type into rows, each row centered horizontally:

```typescript
const TYPE_RANK: Record<string, number> = {
  "goal-and-requirements": 0,
  "architecture-design":   1,
  "module-design":         2,
  "submodule-design":      3,
  "task-spec":             4,
};
```

Unknown types fall back to rank 3.

### 4.2 Fit-to-View

Computes bounding box and scales/translates to fit. Max scale capped at 1.5x.

**Auto-fit on drill/resize:** **[Planned]**

---

## 5. Node Rendering

### 5.1 GraphNode Structure (SVG)

```
<g class="graph-node" transform="translate(x,y)" style="cursor: pointer">
  <rect width=160 height=38 rx=6 fill="var(--elevated)" stroke={borderColor} />
  <line x1=0 y1=0 x2=0 y2=38 stroke={typeColor} strokeWidth=3 />   ← left accent bar
  <text x=12 y=19>{icon} {title}</text>
</g>
```

### 5.2 Type Mapping

| Spec Type | Left Accent Color | Icon |
|---|---|---|
| `goal-and-requirements` | `var(--gold)` | 🎯 |
| `architecture-design` | `var(--purple)` | 🏛 |
| `module-design` | `var(--blue)` | 📦 |
| `submodule-design` | `var(--blue)` | 📦 |
| `task-spec` | `var(--green)` | 📋 |
| (unknown) | `var(--hint)` | (empty) |

### 5.3 Status / Selection Indicator

| Condition | Stroke Color | Stroke Width |
|---|---|---|
| Selected | `var(--blue)` | 2px |
| `done` | `var(--green)` | 1.5px |
| `active` | `var(--blue)` | 1.5px |
| `stale` | `var(--red)` | 1.5px |
| `pending` / `draft` / unknown | `var(--hint)` | 1.5px |

### 5.4 Title Truncation

Titles > 16 characters truncated to 15 + `…`.

### 5.5 Child Count Badge

**[Planned — not implemented]**

---

## 6. Edge Rendering

### 6.1 Arrowhead

```svg
<marker id="arrowhead" markerWidth={8} markerHeight={6} refX={8} refY={3} orient="auto">
  <path d="M0,0 L8,3 L0,6" fill="var(--hint)" />
</marker>
```

### 6.2 Edge Styles

| Edge Type | Dash Pattern | Opacity |
|---|---|---|
| `parent` | solid | 1.0 |
| `implements` | solid | 1.0 |
| `depends-on` | `6,4` | 1.0 |
| `references` | `3,3` | 0.6 |

All edges use `var(--hint)` stroke at 1.5px.

### 6.3 Edge Routing

Straight `<line>` elements connecting bottom-center of source to top-center of target. Only intra-layer edges are drawn.

---

## 7. Cross-Edge Handling

**[Planned — not implemented.]** Cross-layer edges are silently dropped.

---

## 8. Interaction Behaviors

### 8.1 Click Actions

| Action | Behavior |
|---|---|
| Click node with children | Drill down (set `rootId` to node id) |
| Click leaf node | Select via `selectSpec(node.id)` |
| Double click any node | Select via `selectSpec(node.id)` |
| Click canvas background | No action |

### 8.2 Breadcrumb Navigation

| Action | Behavior |
|---|---|
| Click `←` back | Navigate up one level |
| Click ancestor item | Navigate to that ancestor |
| Current item (rightmost) | Non-clickable span |

### 8.3 Zoom Controls

| Button | Action |
|---|---|
| `+` | `scale = Math.min(2.0, scale * 1.2)` |
| `−` | `scale = Math.max(0.3, scale / 1.2)` |
| `⊙` | Fit to view |

Zoom is multiplicative (×1.2), range 0.3x–2.0x.

### 8.4 Pan

**[Planned — not implemented.]** No click-drag panning.

### 8.5 Keyboard Navigation

**[Planned — not implemented.]**

### 8.6 Context Menu

**[Planned — not implemented.]**

---

## 9. Transition Animations

**[Planned — not implemented.]** Layer changes are instant.

---

## 10. State Management

### Zustand Store: `useSpecStore`

```typescript
interface SpecStore {
  graph: SpecGraph | null;
  selectedSpecId: string | null;
  fetchGraph: () => Promise<void>;
  selectSpec: (id: string | null) => void;
  onSpecChanged: (id: string) => void;
  onSpecCreated: (id, path) => void;
  onSpecDeleted: (id) => void;
  onRegistryUpdated: () => void;
}
```

### Local State in GraphView

```typescript
const [rootId, setRootId] = useState<string | null>(null);
const [transform, setTransform] = useState<Transform>({ scale: 1, translateX: 0, translateY: 0 });
```

`layer` and `positions` derived via `useMemo`.

---

## 11. Empty State

When `graph === null`:
```html
<div class="graph-empty"><div class="graph-empty-text">No specs found</div></div>
```

---

## 12. Legend

**Node types** (colored squares): Goal (gold), Architecture (purple), Module (blue), Task (green)

**Edge styles** (line swatches): Parent (solid), Depends (dashed), Reference (dotted)

---

## 13. CSS Class Reference

| Class | Element |
|---|---|
| `.graph-view` | Top-level container |
| `.graph-canvas` | SVG canvas (`flex: 1`, `bg: var(--bg)`) |
| `.graph-node` | SVG `<g>` per node |
| `.edge-layer` | SVG `<g>` for edges |
| `.graph-breadcrumb` | Breadcrumb bar |
| `.graph-breadcrumb-back` | Back button |
| `.graph-breadcrumb-item` | Ancestor button (blue, underline hover) |
| `.graph-breadcrumb-sep` | › separator |
| `.graph-breadcrumb-current` | Current item (non-clickable) |
| `.graph-controls` | Zoom controls container (absolute bottom-right) |
| `.graph-control-btn` | Zoom button (24×24px) |
| `.graph-control-zoom` | Zoom percentage display |
| `.graph-legend` | Legend container (absolute bottom-left) |
| `.graph-legend-item` | Legend entry |
| `.graph-legend-dot` | Node type color swatch (8×8px) |
| `.graph-legend-line` | Edge style swatch |
| `.graph-empty` | Empty state container |
| `.graph-empty-text` | Empty state message |

---

## 14. Known Limitations

- **No pan by drag** — only fit-to-view button
- **No auto-fit on drill** — viewport stays at previous transform
- **No resize reactivity** — layout doesn't recompute on panel resize
- **No animations** — layer transitions are instant
- **No context menu** — right-click has no effect
- **No keyboard navigation** — arrow keys, Enter, Escape not wired
- **No cross-edge indicators** — edges spanning layers silently dropped
- **No child count badge** — no visual indication a node can be drilled into
- **No status dot** — status encoded only in rect border color
- **Title truncation hard-coded** — 16-character limit
- **No full-graph view** — only one layer visible at a time

---

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §4.1
- **Depends on:** [Spec Module](../../backend/app/spec/README.md) (`spec/graph` RPC), [API Client](../src/api/README.md)
- **Related:** [Theming](THEMING.md) (CSS variables for node colors)
