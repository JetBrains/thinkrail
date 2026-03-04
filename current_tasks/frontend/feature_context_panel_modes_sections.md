# Create Context Panel mode components and placeholder sections

Build the 4 mode components and 13 section components for the Context Panel. Sections are placeholders with descriptive text showing what they will display — except `ConnectedSpecs` which embeds the existing `GraphView` component.

## Context

Depends on: `feature_context_panel_infrastructure.md` (useContextMode hook + CollapsibleSection wrapper). Each mode component composes a set of section components using CollapsibleSection. Sections are stubs that will be implemented individually later.

See [CONTEXT_PANEL.md](../../frontend/ui-specs/CONTEXT_PANEL.md) for the full design.

## Plan

### Create section components (placeholders)

All in `frontend/src/components/ContextPanel/sections/`:

**Spec Context sections:**
1. `ConnectedSpecs.tsx` — **Embeds existing `GraphView` component** inside a CollapsibleSection. Add `[⇱]` expand-to-center button. This is the one non-placeholder section.
2. `LinkedTasks.tsx` — Placeholder: "Tasks linked to this spec will appear here"
3. `CoveredFiles.tsx` — Placeholder: "Files covered by this spec will appear here"
4. `SpecHealth.tsx` — Placeholder: "Spec health summary will appear here" (collapsed by default)

**Agent Context sections:**
5. `TaskSpecPreview.tsx` — Placeholder: "Task spec driving this session will appear here"
6. `FilesModified.tsx` — Placeholder: "Files modified by agent will appear here"
7. `RelatedSpecs.tsx` — Placeholder: "Specs related to this session will appear here"
8. `ComplianceHints.tsx` — Placeholder: "Compliance tracking will appear here"

**Code Context sections:**
9. `CoveringSpecs.tsx` — Placeholder: "Specs covering this file will appear here"
10. `RelatedTasks.tsx` — Placeholder: "Tasks related to this file will appear here"
    (Note: `SpecHealth` is reused from Spec Context)

**Dashboard sections:**
11. `SpecCoverage.tsx` — Placeholder: "Project spec coverage summary will appear here"
12. `OpenTasks.tsx` — Placeholder: "Open tasks grouped by module will appear here"
13. `RecentActivity.tsx` — Placeholder: "Recent activity timeline will appear here"

### Create mode components

All in `frontend/src/components/ContextPanel/modes/`:

1. `SpecContext.tsx` — Renders: ConnectedSpecs, LinkedTasks, CoveredFiles, SpecHealth
2. `AgentContext.tsx` — Renders: TaskSpecPreview, FilesModified, RelatedSpecs, ComplianceHints
3. `CodeContext.tsx` — Renders: CoveringSpecs, RelatedTasks, SpecHealth
4. `ProjectDashboard.tsx` — Renders: SpecCoverage, OpenTasks, RecentActivity

Each mode component is a simple composition — imports its sections and renders them in order inside a scrollable container.

### Placeholder style

Each placeholder section should:
- Use `CollapsibleSection` with appropriate title and no count
- Render a subtle, centered message in muted text (use `--fg-muted` CSS var)
- Be expandable/collapsible like real sections
- Take up minimal height when expanded (~60px)

## Files to create
- `frontend/src/components/ContextPanel/sections/ConnectedSpecs.tsx`
- `frontend/src/components/ContextPanel/sections/LinkedTasks.tsx`
- `frontend/src/components/ContextPanel/sections/CoveredFiles.tsx`
- `frontend/src/components/ContextPanel/sections/SpecHealth.tsx`
- `frontend/src/components/ContextPanel/sections/TaskSpecPreview.tsx`
- `frontend/src/components/ContextPanel/sections/FilesModified.tsx`
- `frontend/src/components/ContextPanel/sections/RelatedSpecs.tsx`
- `frontend/src/components/ContextPanel/sections/ComplianceHints.tsx`
- `frontend/src/components/ContextPanel/sections/CoveringSpecs.tsx`
- `frontend/src/components/ContextPanel/sections/RelatedTasks.tsx`
- `frontend/src/components/ContextPanel/sections/SpecCoverage.tsx`
- `frontend/src/components/ContextPanel/sections/OpenTasks.tsx`
- `frontend/src/components/ContextPanel/sections/RecentActivity.tsx`
- `frontend/src/components/ContextPanel/modes/SpecContext.tsx`
- `frontend/src/components/ContextPanel/modes/AgentContext.tsx`
- `frontend/src/components/ContextPanel/modes/CodeContext.tsx`
- `frontend/src/components/ContextPanel/modes/ProjectDashboard.tsx`

## Files to read (for reference)
- `frontend/src/components/GraphView/GraphView.tsx` — to embed in ConnectedSpecs
- `frontend/src/components/ContextPanel/CollapsibleSection.tsx` — from task 1
- `frontend/src/components/ContextPanel/useContextMode.ts` — from task 1
- `frontend/ui-specs/CONTEXT_PANEL.md` — section details and ASCII mockups

## Definition of done
- All 13 section components render inside CollapsibleSection wrappers
- ConnectedSpecs embeds GraphView and has `[⇱]` expand button
- All 4 mode components compose their sections correctly
- Components render without errors when imported
- Placeholder text is descriptive and styled consistently

**Priority:** High
**Started:** 2026-03-04
