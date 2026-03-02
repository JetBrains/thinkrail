# Graph Interactions — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §4.1 | Status: **Active** | Created: 2026-03-02

## Overview

The Graph view renders the spec hierarchy as an interactive layered visualization in the right panel. It receives a `SpecGraph` (nodes + edges) from the backend via `spec/graph` and displays one "layer" at a time — the current root node and its direct children — with drill-down navigation, breadcrumb trail, and context menu integration.

This spec covers: library choice, layout algorithm, layer computation, node rendering, edge routing, interactions, animations, and accessibility.

## Data Model

TypeScript interfaces matching the backend Python models:

```typescript
interface SpecGraph {
  nodes: RegistryEntry[];
  edges: Link[];
}

interface RegistryEntry {
  id: string;
  type: "goal-and-requirements" | "architecture-design" | "module-design"
       | "submodule-design" | "task-spec";
  path: string;
  title: string;
  status: "done" | "active" | "pending" | "waiting" | "stale" | "draft";
  covers: string[];
  tags: string[];
  created: string;
  updated: string;
}

interface Link {
  from: string;   // child, dependent, or implementor
  to: string;     // parent, dependency target, or implemented spec
  type: "parent" | "depends-on" | "implements" | "references";
}
```

**Edge direction convention** (from `registry.json`):
- `parent`: `from` is child, `to` is parent (e.g., `module-spec` → `design-doc`)
- `implements`: `from` is task, `to` is spec it implements
- `depends-on`: `from` depends on `to`
- `references`: `from` references `to`

## 1. Library Choice: No Library — Plain DOM + SVG

**Recommendation:** Absolutely-positioned `<div>` nodes with an SVG overlay for edges. No external graph library.

**Rationale:**

| Factor | Assessment |
| --- | --- |
| Nodes per layer | 3–15 (trivial for DOM) |
| Existing mockup | Already uses `.gnode` divs + SVG lines — proven pattern |
| CSS design system | All colors via CSS variables; library would need adapter |
| Bundle size | React Flow 130KB+, D3 80KB+, Cytoscape 170KB+ — unjustifiable for ≤15 nodes |
| Layout needs | Simple grid — no force simulation needed |
| Animation needs | CSS transitions/keyframes — no physics engine needed |

**What we build ourselves:**
- Grid layout function (~50 lines)
- SVG edge rendering with arrowheads (~30 lines)
- Pan/zoom via CSS `transform` on a container div
- Drill animation via CSS transitions

**When to reconsider:** If full-graph visualization is needed later (all 50+ nodes at once), introduce `@dagrejs/dagre` (8KB) for layout math only — no rendering library.

## 2. Component Hierarchy

```
<GraphView>                              // right-panel tab content
  <GraphBreadcrumb>                      // ancestor trail + back button
    <BreadcrumbBack />                   // "←" button
    <BreadcrumbItem /> ...               // clickable ancestor nodes
    <BreadcrumbCurrent />                // current layer label
  </GraphBreadcrumb>
  <GraphCanvas>                          // pannable/zoomable container
    <GraphBackground />                  // grid dot pattern (CSS)
    <EdgeLayer>                          // <svg> overlay, pointer-events: none
      <Edge /> ...                       // <line> or <path> per visible edge
      <ArrowheadDefs />                  // SVG <defs> for marker arrowheads
    </EdgeLayer>
    <NodeLayer>                          // positioned container for nodes
      <GraphNode /> ...                  // one per visible spec
    </NodeLayer>
  </GraphCanvas>
  <GraphLegend />                        // bottom-left: type colors + edge styles
  <GraphControls />                      // bottom-right: +, −, ⊙ buttons
  <GraphContextMenu />                   // right-click popup (fixed position)
  <GraphEmptyState />                    // shown when no children / no specs
</GraphView>
```

## 3. Layer Computation Algorithm

### 3.1 Structural Children

A node `C` is a **structural child** of node `P` if any of:
- There exists a `parent` edge: `{ from: C, to: P }`
- There exists an `implements` edge: `{ from: C, to: P }`

`depends-on` and `references` are cross-cutting — they do not define the drill hierarchy.

```typescript
function getStructuralChildren(graph: SpecGraph, parentId: string): RegistryEntry[] {
  const childIds = new Set<string>();
  for (const edge of graph.edges) {
    if ((edge.type === "parent" || edge.type === "implements") && edge.to === parentId) {
      childIds.add(edge.from);
    }
  }
  return graph.nodes.filter(n => childIds.has(n.id));
}
```

### 3.2 Finding Roots

Root nodes have no outgoing `parent` or `implements` edges:

```typescript
function findRoots(graph: SpecGraph): RegistryEntry[] {
  const hasParent = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type === "parent" || edge.type === "implements") {
      hasParent.add(edge.from);
    }
  }
  return graph.nodes.filter(n => !hasParent.has(n.id));
}
```

### 3.3 Computing the Visible Layer

```typescript
interface LayerView {
  root: RegistryEntry | null;       // null at top level
  children: RegistryEntry[];         // nodes shown in this layer
  intraEdges: Link[];                // edges between visible nodes
  crossEdges: CrossEdgeIndicator[];  // edges leaving/entering this layer
  breadcrumb: RegistryEntry[];       // ancestor path from true root
}

interface CrossEdgeIndicator {
  nodeId: string;       // visible node
  targetId: string;     // off-screen node
  direction: "outgoing" | "incoming";
  type: string;         // edge type
}
```

**Algorithm:**

1. Determine children: if `currentRootId` is null → `findRoots()`, else → `getStructuralChildren()`
2. Collect visible IDs (children + root if present)
3. Filter edges to those connecting visible nodes → `intraEdges`
4. Identify `depends-on`/`references` edges with one end off-screen → `crossEdges`
5. Build breadcrumb by walking parent edges upward

### 3.4 Auto-Drill Single Root

If `findRoots()` returns exactly 1 node, auto-drill into it on mount. This prevents displaying a single lonely node and immediately shows the interesting layer.

### 3.5 Breadcrumb Construction

Walk `parent`/`implements` edges upward from `currentRootId`:

```typescript
function buildBreadcrumb(graph: SpecGraph, nodeId: string | null): RegistryEntry[] {
  const trail: RegistryEntry[] = [];
  let current = nodeId;
  while (current) {
    const node = graph.nodes.find(n => n.id === current);
    if (node) trail.unshift(node);
    const parentEdge = graph.edges.find(
      e => (e.type === "parent" || e.type === "implements") && e.from === current
    );
    current = parentEdge ? parentEdge.to : null;
  }
  return trail;
}
```

## 4. Layout Algorithm

### 4.1 Grid Layout with Rank Grouping

Nodes arranged in rows by spec type, centered horizontally:

```
Row 0: goal-and-requirements nodes
Row 1: architecture-design nodes
Row 2: module-design / submodule-design nodes
Row 3: task-spec nodes
```

```typescript
interface NodePosition { id: string; x: number; y: number; }

const NODE_WIDTH  = 160;
const NODE_HEIGHT = 38;
const H_GAP       = 30;
const V_GAP       = 50;
const PADDING      = 20;

const TYPE_RANK: Record<string, number> = {
  "goal-and-requirements": 0,
  "architecture-design": 1,
  "module-design": 2,
  "submodule-design": 2,
  "task-spec": 3,
};

function layoutLayer(children: RegistryEntry[], canvasWidth: number): NodePosition[] {
  const positions: NodePosition[] = [];

  // Group by rank
  const groups = new Map<number, RegistryEntry[]>();
  for (const child of children) {
    const rank = TYPE_RANK[child.type] ?? 2;
    if (!groups.has(rank)) groups.set(rank, []);
    groups.get(rank)!.push(child);
  }

  let currentY = PADDING;
  for (const rank of [...groups.keys()].sort()) {
    const row = groups.get(rank)!;
    const totalWidth = row.length * NODE_WIDTH + (row.length - 1) * H_GAP;
    const startX = Math.max(PADDING, (canvasWidth - totalWidth) / 2);

    for (let i = 0; i < row.length; i++) {
      positions.push({
        id: row[i].id,
        x: startX + i * (NODE_WIDTH + H_GAP),
        y: currentY,
      });
    }
    currentY += NODE_HEIGHT + V_GAP;
  }

  return positions;
}
```

### 4.2 Fit-to-View

The `⊙` control calculates the bounding box of all nodes and scales/pans to fit:

```typescript
interface Transform { scale: number; translateX: number; translateY: number; }

function fitToView(positions: NodePosition[], canvasW: number, canvasH: number): Transform {
  if (positions.length === 0) return { scale: 1, translateX: 0, translateY: 0 };

  const minX = Math.min(...positions.map(p => p.x));
  const maxX = Math.max(...positions.map(p => p.x + NODE_WIDTH));
  const minY = Math.min(...positions.map(p => p.y));
  const maxY = Math.max(...positions.map(p => p.y + NODE_HEIGHT));

  const contentW = maxX - minX + 2 * PADDING;
  const contentH = maxY - minY + 2 * PADDING;

  const scale = Math.min(canvasW / contentW, canvasH / contentH, 1.5);

  return {
    scale,
    translateX: (canvasW - contentW * scale) / 2 - minX * scale + PADDING * scale,
    translateY: (canvasH - contentH * scale) / 2 - minY * scale + PADDING * scale,
  };
}
```

## 5. Node Rendering

### 5.1 GraphNode Structure

```
┌─────────────────────────────────────┐
│ ● 📦 Spec Module               ▸3  │
└─────────────────────────────────────┘
 ↑  ↑   ↑                         ↑
 │  │   title                     child count badge
 │  type icon
 status dot
```

```html
<div class="gnode {typeClass} {stateClasses}"
     style="top:{y}px; left:{x}px; width:160px"
     tabindex="0"
     role="button"
     aria-label="{title}, {type}, {status}">
  <span class="gnode-status {statusClass}"></span>
  <span class="gnode-icon">{icon}</span>
  <span class="gnode-title">{title}</span>
  <span class="gnode-badge" title="{N} children">▸{N}</span>
</div>
```

### 5.2 Type Mapping

| Spec Type | CSS Class | Icon | Color Variable |
| --- | --- | --- | --- |
| `goal-and-requirements` | `.goal` | 🎯 | `--gold` |
| `architecture-design` | `.arch` | 🏛 | `--purple` |
| `module-design` | `.module` | 📦 | `--blue` |
| `submodule-design` | `.submod` | 📦 | `--blue` |
| `task-spec` | `.task` | 📋 | `--green` |

### 5.3 Status Indicator

| Status | Color | Animation |
| --- | --- | --- |
| `done` | `--green` | none |
| `active` | `--blue` | `pulse 1.4s infinite` |
| `pending` | `--hint` | none |
| `waiting` | `--gold` | none |
| `stale` | `--red` | none |
| `draft` | `--hint` | none, 50% opacity |

### 5.4 Child Count Badge

- Shown only when node has structural children (badge hidden for leaves)
- Content: `▸{count}` (e.g., `▸3`)
- Font size: 9px, color: `--hint`
- Signals that clicking will drill down

### 5.5 Selection / Highlight States

| State | Visual | Trigger |
| --- | --- | --- |
| Default | Normal | — |
| Hovered | `transform: scale(1.05)`, z-index bump | Mouse enter |
| Selected | `box-shadow: 0 0 12px 2px currentColor` | Double-click or context link |
| Active session | Pulsing border (2px, `pulse` animation) | Session context match |
| Related | Brighter border (opacity 1.0 vs 0.6) | Hover on connected node |
| Focused | `outline: 2px solid var(--blue); outline-offset: 2px` | Keyboard navigation |

## 6. Edge Rendering

### 6.1 Edge Layer

An `<svg>` element absolutely positioned over the canvas with `pointer-events: none`.

### 6.2 Edge Styles

| Edge Type | Stroke Width | Dash Pattern | Arrow | Color |
| --- | --- | --- | --- | --- |
| `parent` | 1.5px | solid | yes (end) | `--hint` |
| `implements` | 1.5px | solid | yes (end) | `--hint` |
| `depends-on` | 1.5px | `6,4` dashed | yes (end) | `--border` |
| `references` | 1px | `3,3` dotted | yes (end) | `--border` (60% opacity) |

### 6.3 Edge Routing

- **Cross-row edges** (vertical): straight lines, clipped to node borders
- **Same-row edges** (horizontal): slight cubic bezier curve arching upward to avoid passing through intermediate nodes:

```svg
<path d="M {x1} {y1} C {x1} {y1-20}, {x2} {y2-20}, {x2} {y2}"
      stroke="..." fill="none" marker-end="url(#arrowhead)" />
```

### 6.4 Arrowhead Definitions

```svg
<defs>
  <marker id="arrowhead" markerWidth="8" markerHeight="6"
          refX="8" refY="3" orient="auto">
    <polygon points="0 0, 8 3, 0 6" fill="#565f89" />
  </marker>
</defs>
```

One marker definition per edge color variant.

## 7. Cross-Edge Handling

When a `depends-on` or `references` edge connects a visible node to an off-screen node, the full edge cannot be drawn.

### 7.1 Cross-Edge Badges

Small badges on nodes with off-screen dependencies:

```
┌─────────────────────────────────────┐
│ ● 📦 Spec Module            ↗2 ▸3  │
└─────────────────────────────────────┘
                                ↑
                          2 outgoing cross-edges
```

- `↗{N}` for outgoing (this node depends on N off-screen nodes)
- `↙{N}` for incoming (N off-screen nodes depend on this)
- Color: `--hint`

### 7.2 Badge Tooltip

On hover, show a tooltip listing off-screen nodes:

```
Depends on:
  📦 Core Module
  🎯 Goal & Requirements
```

Clicking a tooltip entry navigates to the layer containing that node.

## 8. Interaction Behaviors

### 8.1 Click Actions

| Action | Behavior |
| --- | --- |
| Single click on node with children | Drill down: animate to child layer |
| Single click on leaf node | Select: highlight, update Spec/Code/Diff views |
| Double click on any node | Select without drill: highlight, update right panel |
| Right click on any node | Open context menu at cursor |
| Click canvas background | Deselect current node |

### 8.2 Breadcrumb

| Action | Behavior |
| --- | --- |
| Click `←` back button | Navigate up one layer |
| Click any ancestor item | Navigate to that ancestor's layer |
| Current item (rightmost) | Non-clickable, shows current position |

### 8.3 Context Menu

```
┌──────────────────────────────┐
│ AI ACTIONS                   │
│ ✨ New session for this spec │
│ 💬 Ask about this spec       │
│ 🔨 Implement / Specify       │
│ ✏️ Edit spec                  │
│──────────────────────────────│
│ NAVIGATE                     │
│ 🔽 Drill into children       │
│ 📄 Open in Spec view         │
│ 💻 View related code         │
│ ⎇  View diff                 │
└──────────────────────────────┘
```

- "Implement / Specify" label: if `status === "draft"` → "Specify", else → "Implement"
- "Drill into children" hidden for leaf nodes
- Dismissed on click outside or `Escape`

### 8.4 Zoom / Pan Controls

| Button | Action | Keyboard |
| --- | --- | --- |
| `+` | Zoom in by 0.2 step | `Cmd+=` |
| `−` | Zoom out by 0.2 step | `Cmd+-` |
| `⊙` | Fit all nodes to view | `Cmd+0` |

- **Zoom range:** 0.3x to 2.0x
- **Pan:** Click-drag on background. Cursor: `grab` → `grabbing`
- **Scroll zoom:** `Ctrl+scroll` zooms centered on cursor
- **Implementation:** Single CSS `transform: translate(Tx, Ty) scale(S)` on the canvas container

### 8.5 Keyboard Navigation

| Key | Action |
| --- | --- |
| Arrow keys | Move focus spatially (nearest node in direction) |
| Enter | Drill into focused node (if has children) |
| Space | Select focused node (update right panel) |
| Escape | Go up one layer |
| Tab | Move focus to next node in DOM order |

Spatial navigation finds the nearest node in the arrow direction by Euclidean distance.

## 9. Transition Animations

### 9.1 Drill Down

Two-phase animation (~400ms total):

**Phase 1 — Exit (200ms):**
```css
.gnode.drill-exit {
  transition: opacity 0.2s ease-out, transform 0.2s ease-out;
  opacity: 0; transform: scale(0.9);
}
.gnode.drill-target {
  transition: opacity 0.2s ease-out, transform 0.2s ease-out;
  opacity: 0; transform: scale(1.2);
}
```

**Phase 2 — Enter (250ms, 150ms delay):**
```css
.gnode.drill-enter {
  animation: drillEnter 0.25s ease-out 0.15s both;
}
@keyframes drillEnter {
  from { opacity: 0; transform: scale(0.85); }
  to   { opacity: 1; transform: scale(1); }
}
```

### 9.2 Navigate Up

Reverse motion: current children shrink, parent layer fades in from expanded.

```css
.gnode.up-exit {
  transition: opacity 0.2s ease-out, transform 0.2s ease-out;
  opacity: 0; transform: scale(0.85);
}
.gnode.up-enter {
  animation: upEnter 0.25s ease-out 0.15s both;
}
@keyframes upEnter {
  from { opacity: 0; transform: scale(1.1); }
  to   { opacity: 1; transform: scale(1); }
}
```

### 9.3 Edge Transitions

Edges fade in/out with nodes:

```css
.edge-line { transition: opacity 0.25s ease-out; }
.edge-line.exiting { opacity: 0; }
.edge-line.entering { animation: fadeIn 0.25s ease-out 0.2s both; }
```

### 9.4 Selection Highlight

```css
.gnode.selected {
  box-shadow: 0 0 12px 2px currentColor;
  transition: box-shadow 0.15s ease-out;
}
```

Connected edges flash brighter (opacity 0.6 → 1.0 for 300ms) on selection.

## 10. Viewport Management

### 10.1 Initial Load

1. Fetch `spec/graph` data
2. Compute default layer (auto-drill single root)
3. Run layout algorithm
4. Fit-to-view
5. Render instantly (no animation)

### 10.2 Auto-Fit on Drill

After each drill/navigate transition completes, auto-fit the new layer (200ms `ease-out`).

### 10.3 Resize Handling

When right panel is resized via drag handle:
- Debounce layout recalculation by 150ms
- Re-run layout with new `canvasWidth`
- Re-run fit-to-view
- Nodes reposition with 200ms CSS transition

### 10.4 Pan Constraints

Pan is unconstrained. Fit-to-view resets position.

## 11. Context Linking

### 11.1 Session → Graph

When an active session references a spec:
- Corresponding node gets `.active-session` class (pulsing border)
- If the node is not in the current layer, auto-drill to the layer containing it
- Auto-drill debounced at 500ms to prevent rapid switching during agent exploration

### 11.2 Graph → Right Panel

When a node is selected (double-click or context menu):
- Spec tab loads that spec's content
- Code tab loads files from spec's `covers` field
- Diff tab shows changes to those files

### 11.3 Left Panel → Graph

When a spec is clicked in the left panel tree:
- Graph navigates to the layer containing that spec
- Node gets `.selected` class

## 12. Empty States

### 12.1 No Specs

```
┌──────────────────────────────────────┐
│                                      │
│          No specs yet                │
│                                      │
│   Create your first spec with        │
│   the + New Session button           │
│                                      │
└──────────────────────────────────────┘
```

Centered, `--hint` color.

### 12.2 Node Has No Children (defensive)

```
┌──────────────────────────────────────┐
│   📋 {Node Title}                    │
│                                      │
│   This spec has no child specs.      │
│   [+ Create sub-spec]               │
└──────────────────────────────────────┘
```

"Create sub-spec" opens a new session modal pre-configured to create a child spec.

### 12.3 Loading State

Skeleton loader: 4 placeholder rectangles in grid layout with subtle pulse animation. Breadcrumb shows "Loading..."

## 13. Performance

### 13.1 Scale Expectations

| Nodes | Visible/Layer | Concern | Mitigation |
| --- | --- | --- | --- |
| < 50 | < 15 | None | — |
| 50–100 | 10–25 | Layout calc | Memoize `computeLayer` by `currentRootId` + graph version |
| 100–200 | 15–40 | DOM count | Still fine — 40 divs + 60 SVG lines is trivial |
| 200+ | 20–50+ | Edge lookup | Index edges by node ID in a `Map` for O(1) |

### 13.2 Specific Optimizations

1. **Edge index:** On graph data receipt, build `Map<string, Link[]>` by `from` and `to` fields. Makes `getStructuralChildren` O(1).
2. **Layout memoization:** Cache results by `(currentRootId, canvasWidth)`. Invalidate on graph data change.
3. **Transition batching:** Batch DOM changes into a single `requestAnimationFrame`.
4. **SVG batching:** If edge count > 20 per layer, render as single `<path>` with multiple segments.

### 13.3 Graph Data Caching

Cache `spec/graph` response client-side. Invalidate on:
- `spec/didChange` / `spec/didCreate` / `spec/didDelete` notifications
- `registry/didUpdate` notification
- Session completion that modified specs

## 14. Accessibility

### 14.1 ARIA Roles

```html
<div class="graph-view" role="application" aria-label="Specification graph">
  <nav class="graph-breadcrumb" aria-label="Graph navigation breadcrumb">
    <button class="gb-back" aria-label="Navigate up one level">←</button>
    ...
  </nav>
  <div class="graph-canvas" role="group" aria-label="Graph nodes">
    <div class="gnode" role="button" tabindex="0"
         aria-label="Spec Module, module-design, active, 3 children">
      ...
    </div>
  </div>
</div>
```

### 14.2 Focus Management

- On drill down → focus moves to first child node
- On navigate up → focus moves to the node previously drilled into
- `Escape` → focus moves to breadcrumb back button
- Tab order follows visual position (left-to-right, top-to-bottom)

### 14.3 Screen Reader Announcements

`aria-live="polite"` region announces:
- Layer change: "Navigated to {title}, showing {N} children"
- Node selection: "{title} selected"
- Context menu open: focus moves to first menu item

### 14.4 Color Independence

All visual states use color AND shape/text:
- Status: colored dot + text label in tooltip
- Type: colored border + emoji icon
- Edge type: color + dash pattern
- Selection: color + glow + outline

### 14.5 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .gnode, .edge-line, .gnode-status {
    animation: none !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 15. State Management

### 15.1 State Shape

```typescript
interface GraphState {
  // Data
  graph: SpecGraph | null;
  graphVersion: number;

  // Navigation
  currentRootId: string | null;
  breadcrumb: RegistryEntry[];

  // Selection
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  focusedNodeId: string | null;

  // Viewport
  transform: Transform;

  // UI
  contextMenu: { nodeId: string; x: number; y: number } | null;
  transitioning: boolean;

  // Computed (derived, memoized)
  layer: LayerView;
  positions: NodePosition[];
}
```

### 15.2 Actions

| Action | Trigger | Effect |
| --- | --- | --- |
| `setGraphData` | RPC response / notification | Update `graph`, recompute layer |
| `drillDown(nodeId)` | Click node with children | Set `currentRootId`, animate transition |
| `navigateUp` | Back button or Escape | Walk parent edge upward, animate |
| `navigateTo(nodeId)` | Breadcrumb click or cross-panel link | Set root, animate |
| `selectNode(nodeId)` | Double-click or context link | Set `selectedNodeId`, notify other panels |
| `hoverNode(nodeId \| null)` | Mouse enter/leave | Set `hoveredNodeId`, highlight related edges |
| `focusNode(nodeId)` | Keyboard navigation | Set `focusedNodeId` |
| `openContextMenu(nodeId, x, y)` | Right-click | Show menu |
| `closeContextMenu` | Click outside or Escape | Hide menu |
| `setTransform(t)` | Pan, zoom, or fit | Update viewport |

## 16. CSS Class Reference

### Existing (from mockup — preserve as-is)

| Class | Element |
| --- | --- |
| `.graph-area` | Container |
| `.graph-bg` | Grid background |
| `.graph-breadcrumb` | Breadcrumb bar |
| `.gb-back`, `.gb-item`, `.gb-current`, `.gb-sep` | Breadcrumb parts |
| `.graph-canvas` | Pan/zoom area |
| `.gnode` | Node box |
| `.gnode.goal`, `.gnode.arch`, `.gnode.module`, `.gnode.task` | Type variants |
| `.gnode.selected` | Selected state |
| `.gnode-status`, `.gnode-status.done`, `.active`, `.pending` | Status dot |
| `.legend`, `.legend-row`, `.legend-dot` | Legend |
| `.gcontrols`, `.gctl` | Zoom controls |

### New (introduced by this spec)

| Class | Element |
| --- | --- |
| `.gnode.submod` | Submodule type (same colors as `.module`) |
| `.gnode.active-session` | Session-linked pulsing border |
| `.gnode-icon` | Type emoji span |
| `.gnode-title` | Truncated title text |
| `.gnode-badge` | Child count badge (`▸N`) |
| `.gnode-crossbadge` | Cross-edge indicator (`↗N`) |
| `.gnode.drill-exit`, `.drill-target`, `.drill-enter` | Drill-down animation |
| `.gnode.up-exit`, `.up-enter` | Navigate-up animation |
| `.edge-line` | SVG edge element |
| `.edge-line.exiting`, `.entering` | Edge transition |
| `.graph-empty` | Empty state container |
| `.graph-skeleton` | Loading skeleton |
| `.graph-tooltip` | Cross-edge hover tooltip |

## Known Limitations

- **No full-graph view:** Only one layer visible at a time — no option to see the complete hierarchy at once
- **No custom node positioning:** Layout is algorithmic only — users cannot drag nodes to custom positions
- **Edge routing is basic:** Straight lines and simple curves — no smart routing around obstacles

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §4.1
- **Depends on:** [Spec Module](../../backend/app/spec/README.md) (graph data via spec/graph), [API Client](../src/api/README.md)
- **Related:** [New Session Modal](NEW_SESSION_MODAL.md) (context menu → new session), [Theming](THEMING.md) (node colors)
