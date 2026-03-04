# Implement SpecTree: hierarchical spec tree view in left panel Specs tab

The Specs tab in the left panel currently shows a placeholder. Users need to browse the project's specifications organized by hierarchy (goal → architecture → module → submodule → task) to understand project structure and navigate to specific specs.

The data layer is fully ready — `specStore` has `specs[]`, `graph` (SpecGraph with nodes + parent edges), `selectedSpecId`, and live WebSocket event handlers that auto-refresh on changes. The `useSpecs()` and `useGraph()` hooks are also available. Only the UI component is missing.

Reference implementation: `FileTree.tsx` uses a flat-list-with-depth pattern (entries with `depth` property, `collapsed` Set, ancestor-based visibility filtering). SpecTree should follow the same pattern for consistency.

## Plan

1. **Create `treeUtils.ts`** — pure functions:
   - `buildTree(graph: SpecGraph): TreeNode[]` — extract parent edges, find roots, DFS flatten with depth and type-rank sorting (goal=0, arch=1, module=2, submodule=3, task=4)
   - `specTypeIcon(type: string): { icon: string; cls: string }` — map spec type to emoji + CSS class
   - `statusBadge(status: string): { badge: string; cls: string }` — map status to badge character + CSS class
   - `TreeNode` interface: `{ id, title, type, status, path, depth, parentId, hasChildren }`

2. **Create `SpecTree.tsx`** — React component:
   - Read from `useSpecStore()`: `specs`, `graph`, `selectedSpecId`, `selectSpec`, `fetchSpecs`, `fetchGraph`, `fetchSpecContent`
   - Read from `useUiStore()`: `setRightTab`
   - Local state: `collapsed: Set<string>` for expand/collapse
   - `useMemo` to build tree from graph
   - Filter visible nodes by checking collapsed ancestors
   - Render flat list with depth-based indentation (matching FileTree pattern)
   - Click → `selectSpec(id)`, toggle collapse if has children
   - Double-click → `fetchSpecContent(id)` + `setRightTab("spec")`
   - Loading/empty/error states

3. **Create `SpecTree.css`** — styles with `st-` prefix:
   - Row styles: `.st-row`, `.st-row-selected`, hover highlight
   - Indent guides at each depth level
   - Arrow, icon, title, badge layout
   - Type-specific icon colors
   - Status badge colors (green=done, blue=active, dim=pending, yellow=stale, orange=waiting)
   - Match FileTree visual language and Catppuccin theme tokens

4. **Update `LeftPanel.tsx`** — wire SpecTree into tab content:
   - Import `SpecTree` component
   - Add `if (tab === "specs") return <SpecTree />;` in `TabContent`

## Files to modify

- `frontend/src/components/SpecTree/treeUtils.ts` — **NEW** — tree-building logic, icon/badge mappings
- `frontend/src/components/SpecTree/SpecTree.tsx` — **NEW** — tree component with interactions
- `frontend/src/components/SpecTree/SpecTree.css` — **NEW** — component styles
- `frontend/src/components/AppShell/LeftPanel.tsx` — **MOD** — import and render SpecTree for "specs" tab

## Definition of done

- [ ] Specs tab displays hierarchical tree of all specs from registry
- [ ] Tree nodes show type icon, title, and status badge
- [ ] Click selects a spec (highlighted row, updates specStore.selectedSpecId)
- [ ] Double-click opens spec content in right panel Spec tab
- [ ] Expand/collapse works on nodes with children
- [ ] Tree auto-updates when specs are created/changed/deleted (via specStore)
- [ ] Loading and empty states display correctly
- [ ] Unit tests for `treeUtils.ts` pass (buildTree, specTypeIcon, statusBadge)
- [ ] `npm run lint` passes with no new errors

**Priority:** High
**Type:** New feature
**Spec:** [SpecTree README](../../frontend/src/components/SpecTree/README.md)
**Started:** 2026-03-04
