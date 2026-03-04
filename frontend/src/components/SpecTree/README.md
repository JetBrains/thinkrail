# SpecTree — Component Specification

> Parent: [Frontend Module](../../../README.md) | Status: **Active** | Created: 2026-03-04

## Purpose

SpecTree renders the project's specifications as a collapsible hierarchical tree in the left panel Specs tab. It derives the tree structure from the SpecGraph (parent edges), displays type-specific icons and status badges per node, and wires selection to specStore for cross-panel coordination.

## Internal Architecture

```
┌──────────────────────────────────────────────────┐
│  LeftPanel.tsx                                    │
│    <SpecTree />                                   │
├──────────────────────────────────────────────────┤
│  SpecTree.tsx (render + interactions)             │
│    - reads specStore (specs, graph, selectedId)   │
│    - collapsed Set, expandedTasks Set (local)     │
│    - click → selectSpec(), dblclick → open spec   │
│    - task pill → toggle task card                 │
├──────────────────────────────────────────────────┤
│  treeUtils.ts (pure functions)                    │
│    - buildTree(graph) → TreeNode[]                │
│    - getTasksForSpec(graph) → Map<id, TaskInfo[]> │

│    - specTypeIcon(type) → icon + class            │
│    - statusBadge(status) → badge + class          │
├──────────────────────────────────────────────────┤
│  specStore (Zustand) ← auto-updates via WS events │
│    specs[], graph, selectedSpecId                 │
└──────────────────────────────────────────────────┘
```

Two layers:
1. **treeUtils.ts** — pure functions that transform SpecGraph into a flat, depth-sorted tree and provide icon/badge mappings
2. **SpecTree.tsx** — React component that renders the tree, manages expand/collapse state, and wires user interactions to stores

## File Organization

```
frontend/src/components/SpecTree/
├── SpecTree.tsx      # Tree component — render + interactions
├── SpecTree.css      # Styles (matches FileTree visual language)
├── treeUtils.ts      # buildTree(), getTasksForSpec(), specTypeIcon(), statusBadge()
└── README.md         # This spec
```

## Data Types

```typescript
/** Flat tree node produced by buildTree() — excludes task-spec nodes */
interface TreeNode {
  id: string;          // spec ID (matches RegistryEntry.id)
  title: string;       // display title
  type: string;        // "goal-and-requirements" | "architecture-design" | "module-design" | "submodule-design"
  status: string;      // "active" | "done" | "pending" | "stale" | "waiting"
  path: string;        // file path (for tooltip)
  depth: number;       // nesting level (0 = root)
  parentId: string | null;  // parent spec ID (for collapse filtering)
  hasChildren: boolean;     // whether this node has children
}

/** Task associated with a spec via `implements` link */
interface TaskInfo {
  id: string;          // task spec ID
  title: string;       // task title
  status: string;      // "active" | "done" | etc.
}
```

## treeUtils.ts

### buildTree(graph: SpecGraph): TreeNode[]

Transforms the spec graph into a sorted flat list:

1. **Extract parent→child relationships** from `graph.edges` where `link.type === "parent"` (link direction: child→parent, so `from` = child, `to` = parent)
2. **Find roots** — nodes with no parent edge
3. **Sort children** within each parent by type rank, then alphabetically:
   - Type rank: goal-and-requirements=0, architecture-design=1, module-design=2, submodule-design=3, task-spec=4
4. **Flatten via DFS** — depth-first traversal assigning incrementing `depth`
5. Return `TreeNode[]` in display order

```typescript
export function buildTree(graph: SpecGraph): TreeNode[] {
  // Build adjacency: parentId → children[]
  const childrenOf = new Map<string | null, RegistryEntry[]>();
  const parentOf = new Map<string, string>();

  for (const edge of graph.edges) {
    if (edge.type === "parent") {
      parentOf.set(edge.from, edge.to);  // from=child, to=parent
    }
  }

  // Group by parent (exclude task-spec nodes — shown via task pills)
  for (const node of graph.nodes) {
    if (node.type === "task-spec") continue;
    const pid = parentOf.get(node.id) ?? null;
    const siblings = childrenOf.get(pid) ?? [];
    siblings.push(node);
    childrenOf.set(pid, siblings);
  }

  // Sort each group
  const typeRank: Record<string, number> = { "goal-and-requirements": 0, "architecture-design": 1, "module-design": 2, "submodule-design": 3, "task-spec": 4 };
  for (const [, children] of childrenOf) {
    children.sort((a, b) => {
      const ra = typeRank[a.type] ?? 5;
      const rb = typeRank[b.type] ?? 5;
      return ra !== rb ? ra - rb : a.title.localeCompare(b.title);
    });
  }

  // DFS flatten
  const result: TreeNode[] = [];
  function walk(parentId: string | null, depth: number) {
    for (const entry of childrenOf.get(parentId) ?? []) {
      const children = childrenOf.get(entry.id) ?? [];
      result.push({
        id: entry.id,
        title: entry.title,
        type: entry.type,
        status: entry.status,
        path: entry.path,
        depth,
        parentId,
        hasChildren: children.length > 0,
      });
      walk(entry.id, depth + 1);
    }
  }
  walk(null, 0);
  return result;
}
```

### getTasksForSpec(graph: SpecGraph): Map<string, TaskInfo[]>

Builds a map of `specId → TaskInfo[]` using `implements` edges from the graph. Only includes nodes where `type === "task-spec"`. Used to populate task count pills on spec nodes.

### specTypeIcon(type: string): { icon: string; cls: string }

Maps spec type to display icon:

| Type | Icon | CSS Class |
|------|------|-----------|
| `goal-and-requirements` | 🎯 | `st-icon-goal` |
| `architecture-design` | 🏗 | `st-icon-arch` |
| `module-design` | 📦 | `st-icon-module` |
| `submodule-design` | 🧩 | `st-icon-submodule` |
| `task-spec` | ✏️ | `st-icon-task` |
| (unknown) | 📄 | `st-icon-default` |

### statusBadge(status: string): { badge: string; cls: string }

Maps spec status to badge character:

| Status | Badge | CSS Class | Color |
|--------|-------|-----------|-------|
| `done` | ✓ | `st-badge-done` | green |
| `active` | ● | `st-badge-active` | blue |
| `pending` | ○ | `st-badge-pending` | dimmed |
| `stale` | ~ | `st-badge-stale` | yellow |
| `waiting` | ! | `st-badge-waiting` | orange |
| (unknown) | · | `st-badge-unknown` | dimmed |

## SpecTree.tsx

### Component Interface

```tsx
export function SpecTree(): JSX.Element
```

No props — reads all data from Zustand stores:
- `useSpecStore()` — `specs`, `graph`, `selectedSpecId`, `selectSpec()`, `fetchSpecContent()`, `fetchSpecs()`, `fetchGraph()`
- `useFileStore()` — `openFile()`

### State

| State | Type | Scope | Description |
|-------|------|-------|-------------|
| `collapsed` | `Set<string>` | local (useState) | Set of collapsed node IDs |
| `expandedTasks` | `Set<string>` | local (useState) | Set of spec IDs with task card expanded |
| `specs`, `graph`, `selectedSpecId` | from specStore | global (Zustand) | Reactive — re-renders on change |

### Render Pattern

Follows the same flat-list-with-depth pattern as FileTree:

```tsx
// 1. Build tree from graph
const nodes = useMemo(() => graph ? buildTree(graph) : [], [graph]);

// 2. Filter visible nodes (hide children of collapsed ancestors)
const visible = useMemo(() => {
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  return nodes.filter(node => {
    let current = node.parentId;
    while (current) {
      if (collapsed.has(current)) return false;
      current = nodeMap.get(current)?.parentId ?? null;
    }
    return true;
  });
}, [nodes, collapsed]);

// 3. Render flat list
{visible.map(node => (
  <div
    key={node.id}
    className={`st-row ${selectedSpecId === node.id ? "st-row-selected" : ""}`}
    style={{ paddingLeft: node.depth * 20 + 4 }}
    onClick={() => selectSpec(node.id)}
    onDoubleClick={() => handleDoubleClick(node.id)}
  >
    <span className="st-arrow" onClick={node.hasChildren ? (e) => handleArrowClick(e, node.id) : undefined}>
      {node.hasChildren ? (collapsed.has(node.id) ? "▸" : "▾") : ""}
    </span>
    <span className={`st-icon ${specTypeIcon(node.type).cls}`}>{specTypeIcon(node.type).icon}</span>
    <span className="st-title">{node.title}</span>
    <span className={`st-badge ${statusBadge(node.status).cls}`}>{statusBadge(node.status).badge}</span>
  </div>
))}
```

### Interactions

| Action | Behavior |
|--------|----------|
| **Click node** | `specStore.selectSpec(id)` — updates selectedSpecId, highlights in graph |
| **Click arrow** | Toggle node in `collapsed` Set (stopPropagation — does not select) |
| **Click task pill** | Toggle `expandedTasks` Set (stopPropagation) — shows/hides task card below the node |
| **Double-click** | `fileStore.openFile(path)` — opens spec file in center panel (markdown preview via FileViewer) |

### Loading & Empty States

| State | Display |
|-------|---------|
| `loading && !graph` | `<div className="st-empty">Loading specs...</div>` |
| `graph && nodes.length === 0` | `<div className="st-empty">No specifications yet</div>` |
| `error` | `<div className="st-empty st-error">{error}</div>` |

### Live Updates

SpecTree does **not** subscribe to WebSocket events directly. The data flow is:

```
Backend event → WebSocket → specStore event handler
  → re-fetches specs[] and graph
    → Zustand notifies selectors
      → SpecTree re-renders with new data
```

This means specs created/changed/deleted by the agent are reflected in the tree automatically.

### Data Fetch on Mount

On first render, SpecTree triggers `fetchSpecs()` and `fetchGraph()` if data is not already loaded:

```tsx
useEffect(() => {
  if (specs.length === 0) fetchSpecs();
  if (!graph) fetchGraph();
}, [specs.length, graph, fetchSpecs, fetchGraph]);
```

## Task Display

Task-spec nodes are **excluded from the tree** and instead shown via inline task count pills on each spec node.

### Task Count Pill

Each spec node shows a clickable pill badge after the title (hidden when 0 tasks):
- **0 tasks** — no pill rendered
- **All done** — muted pill (`st-task-pill-done`), visible only on row hover (CSS opacity transition)
- **Has active** — blue-tinted pill (`st-task-pill-active`), always visible
- **Expanded** — purple accent (`st-task-pill-expanded`)

### Task Card

When a pill is clicked, a visually distinct card (`st-task-card`) renders below the spec row. The card is separate from tree children — uses dark background, border, and `role="group"` for accessibility. Each task row shows icon, title, and status badge.

## Styling

CSS class prefix: `st-` (spec tree).

Follows the same visual language as FileTree:
- Indent guides at each depth level
- Hover highlight on rows
- Selected row with accent background
- Monospace font for badges
- Catppuccin-inspired color tokens from global theme

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Flat list with depth | Not recursive components | Matches FileTree pattern. O(n) render, simple collapse filtering. Consistent codebase convention. |
| Read from specStore directly | Not via props | SpecTree is a "connected" component. No benefit to prop-drilling since it's always used in LeftPanel with the same data source. |
| Local collapsed state | Not in Zustand | Collapse state is ephemeral UI state — not worth persisting or sharing across components. |
| Type-rank sorting | goal → arch → module → submodule → task | Mirrors the natural spec hierarchy. Most important specs appear first. |
| buildTree in treeUtils.ts | Not inline in component | Keeps tree-building logic pure and testable. Can unit test without React. |
| Tasks as cards, not tree children | Separate visual treatment | Avoids conflating child specs with tasks. Cards are visually distinct (PatternFly/Telerik guidance). Chevron and pill are independent interactions. |
| Hide zero-count pills | Not "0 tasks" | Reduces noise. Only show when actionable (Linear pattern). |
| Done-only pills on hover | Not always visible | Progressive disclosure — completed tasks are secondary info (PatternFly). |


## Known Limitations

- **No search/filter:** No text search or type filter within the tree
- **No drag-and-drop:** Cannot reorder or reparent specs via drag — hierarchy is defined in registry
- **No context menu:** No right-click actions (create child, delete, rename)
- **Orphan handling:** Specs with broken parent links appear as root nodes (graceful degradation)
- **Task single-click:** Clicking a task card row does not select — only double-click opens the task spec file

## Dependencies

| Dependency | Usage |
|------------|-------|
| React (useState, useMemo, useEffect, useCallback) | Component state, memoization, and stable callbacks |
| Zustand (useSpecStore, useFileStore) | Global state access |
| SpecGraph type | Input to buildTree() |

No external dependencies beyond React and Zustand.

## Related Specs

- **Parent:** [Frontend Module](../../../README.md)
- **Sibling:** [FileTree](../FileTree/) (reference implementation for tree pattern)
- **Data source:** [API Client](../../api/README.md) (useSpecs, useGraph hooks)
- **State:** [State Management](../../store/README.md) (specStore, uiStore)
- **UI spec:** [WEBVIEW.md §2](../../../ui-specs/WEBVIEW.md) (Specs tab behavior)
- **Layout:** [APP_SHELL.md](../../../ui-specs/APP_SHELL.md) (LeftPanel integration)
