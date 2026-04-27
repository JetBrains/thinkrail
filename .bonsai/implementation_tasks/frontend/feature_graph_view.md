---
id: task-fe-graph-view
type: task-spec
status: done
title: Implement Graph View
depends-on:
- task-fe-app-shell
implements:
- graph-interactions
covers:
- frontend/src/components/GraphView/
tags:
- high
- new-feature
- frontend
---
# Implement Graph View

> Interactive spec hierarchy visualization with layered drill-down navigation

**Status:** Done
**Priority:** High
**Depends on:** `feature_app_shell`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/GRAPH_INTERACTIONS.md`

## Summary

The Graph View renders the spec hierarchy as an interactive layered visualization in the right panel. It shows one layer at a time (a root node and its direct children) using plain DOM + SVG — no external graph library. Users drill into nodes to explore children, with a breadcrumb trail for navigation.

## Files to Create

- `frontend/src/components/GraphView/GraphView.tsx` — container: fetches graph, computes layers, manages navigation state
- `frontend/src/components/GraphView/GraphCanvas.tsx` — SVG canvas with zoom/pan (0.3x–2.0x), renders nodes + edges
- `frontend/src/components/GraphView/GraphNode.tsx` — spec node: colored by type, status border, icon, title, click handler
- `frontend/src/components/GraphView/EdgeLayer.tsx` — SVG edges between nodes: solid (parent), dashed (depends-on), dotted (references), arrowheads
- `frontend/src/components/GraphView/GraphBreadcrumb.tsx` — ancestor path with clickable segments and back button
- `frontend/src/components/GraphView/GraphContextMenu.tsx` — right-click menu: Drill, Select, New session, Edit spec
- `frontend/src/components/GraphView/GraphLegend.tsx` — node type colors + edge style legend
- `frontend/src/components/GraphView/GraphControls.tsx` — zoom in/out/reset buttons
- `frontend/src/components/GraphView/GraphEmptyState.tsx` — shown when no specs exist

## Key Implementation Details

### Layer Computation
Given a root node, filter `SpecGraph` to show only direct children (via parent-type links). Compute intra-layer edges (between children) and cross-edge badges (references to/from off-screen nodes).

### Layout Algorithm
Grid layout by spec type rank: goal(0), architecture(1), module(2), submodule(3), task(4). Nodes arranged in columns by rank, centered vertically.

### Node Colors
| Type | Color |
|------|-------|
| Goal | Gold |
| Architecture | Purple |
| Module | Blue |
| Submodule | Cyan |
| Task | Green/Gray |

### Interactions
- Single click: drill into (if children) or select (if leaf)
- Double click: select without drilling
- Right click: context menu
- Arrow keys: navigate between nodes
- Enter: drill into, Escape: go up one level

## Definition of Done

- [ ] Graph renders nodes with correct colors, status borders, and labels
- [ ] Edges render as SVG with correct styles (solid/dashed/dotted)
- [ ] Click drills into node, showing children as new layer
- [ ] Breadcrumb shows ancestor path, clickable for navigation
- [ ] Zoom/pan controls work
- [ ] Context menu offers session/edit actions
- [ ] Keyboard navigation (arrow keys, Enter, Escape)
- [ ] Empty state when no specs exist
