# Task: Implement Spec Context Sections

> Implements: [SPEC_CONTEXT.md](../../frontend/ui-specs/context-panel/SPEC_CONTEXT.md)
> Depends on: `feature_context_panel_shared_infra`
> Status: **active** | Priority: **high** | Created: 2026-03-06

## Goal

Replace placeholder content in the three Spec Context sections with real data-driven UI.

## Deliverables

### 1. ConnectedSpecs — Rewrite

**File:** `frontend/src/components/ContextPanel/sections/ConnectedSpecs.tsx`

**Replace** the `<GraphView />` embed with a grouped list of linked specs.

- Use `useSelectedSpec()` to get the selected spec
- Filter `specStore.graph.edges` for edges involving the selected spec ID
- Group by link type: Parent, Children, Implements, Depends on, Depended by, Implemented by
- Resolve linked spec IDs to titles via `graph.nodes`
- Each item clickable via `specStore.selectSpec(id)`
- Show total count in `CollapsibleSection` count prop
- Omit empty groups
- **Remove** `<GraphView />` import

**New CSS classes:** `.connected-group`, `.connected-group__label`, `.connected-item`

### 2. LinkedTasks

**File:** `frontend/src/components/ContextPanel/sections/LinkedTasks.tsx`

- Use `useSelectedSpec()` to get the selected spec
- Filter `graph.edges` for `type === "implements"` where `to === specId`
- Resolve `from` IDs to `RegistryEntry`, filter where `type` starts with `"task"`
- Sort: active first, then draft, then done
- Render with `StatusBadge` and clickable title → `selectSpec(id)`
- Show count in section header
- Empty state: "No tasks linked to this spec"

**New CSS classes:** `.linked-task`, `.linked-task__status`, `.linked-task__title`

### 3. SpecHealth

**File:** `frontend/src/components/ContextPanel/sections/SpecHealth.tsx`

- Use `useSelectedSpec()` to get the selected spec
- Display 4 rows: Status (StatusBadge), Last Updated (relativeDate), Covers (count), Type
- `defaultExpanded={false}`, `summary={<StatusBadge />}` when collapsed
- If no spec selected: "Select a spec to see health"

**New CSS classes:** `.spec-health`, `.spec-health__row`, `.spec-health__label`

## Acceptance Criteria

- [ ] ConnectedSpecs shows grouped links, no longer renders GraphView
- [ ] LinkedTasks shows task specs with status badges
- [ ] SpecHealth shows status/date/covers/type metadata
- [ ] All sections handle null/empty state gracefully
- [ ] Clicking items navigates (selectSpec or loadPreview)
- [ ] Count badges appear on section headers where applicable

## Dependencies

- Shared infrastructure (hooks + utils) from `feature_context_panel_shared_infra`
- `specStore.graph` must be populated (fetchGraph on mount)
