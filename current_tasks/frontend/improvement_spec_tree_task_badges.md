# Improve SpecTree: inline task count badges with progressive disclosure

Task-spec nodes currently appear as flat orphans at the bottom of the spec tree because they use `implements` links (not `parent` links). With ~40 tasks, they dominate the tree and push important design specs off screen.

This improvement uses `implements` links to associate tasks with their parent spec, then displays a clickable task count pill badge on each spec node. Clicking the pill expands tasks as a visually distinct card — separate from the tree's child spec expansion.

Design based on UX research: PatternFly (badges on tree nodes), Linear (hide zero counts), JetBrains (propagate status to parents), Telerik (tasks as cards not tree children).

## Plan

1. **Update `treeUtils.ts`** — filter task-spec nodes from tree, add `getTasksForSpec()` and `hasActiveDescendant()`:
   - `buildTree()`: skip nodes where `type === "task-spec"`
   - `getTasksForSpec(graph)`: build `Map<specId, TaskInfo[]>` from `implements` edges
   - `hasActiveDescendant(nodeId, taskMap, nodes)`: check if any descendant has active tasks

2. **Update `SpecTree.tsx`** — add task pill and card rendering:
   - New `expandedTasks: Set<string>` state
   - Compute `taskMap` via `useMemo`
   - Render clickable pill after title: hidden for 0, hover-visible for done, always-visible for active
   - Render task card below row when expanded (dark background, `role="group"`)
   - Blue dot on parent nodes with active descendant tasks

3. **Update `SpecTree.css`** — new styles:
   - `.st-task-pill` (base), `-done` (hover reveal), `-active` (blue), `-expanded` (purple)
   - `.st-task-card`, `.st-task-card-row` (dark card with border)
   - `.st-active-dot` (6px blue circle)

4. **Update `README.md` spec** — document new types, functions, state, interactions, styles

## Files to modify
- `frontend/src/components/SpecTree/treeUtils.ts` — **MOD** filter tasks, add getTasksForSpec, hasActiveDescendant
- `frontend/src/components/SpecTree/SpecTree.tsx` — **MOD** expandedTasks state, pill + card rendering
- `frontend/src/components/SpecTree/SpecTree.css` — **MOD** pill, card, dot styles
- `frontend/src/components/SpecTree/README.md` — **MOD** update spec

## Definition of done
- [ ] Task-spec nodes no longer appear as tree nodes
- [ ] Spec nodes with tasks show clickable count pill (hidden for 0, hover for done, visible for active)
- [ ] Clicking pill expands task card below the node (visually distinct from child specs)
- [ ] Blue dot appears on parent nodes when descendants have active tasks
- [ ] `npx tsc --noEmit` passes
- [ ] Spec README updated to match implementation

**Priority:** High
**Type:** Improvement
**Spec:** [SpecTree README](../../frontend/src/components/SpecTree/README.md)
**Mockup:** [tree-mockups.html](../../.specs/tree-mockups.html)
**Started:** 2026-03-04
