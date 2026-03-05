# Replace RightPanel with ContextPanel and clean up store

Swap the current tab-based `RightPanel.tsx` with the new `ContextPanel` component, and remove tab-related state from `uiStore` that is no longer needed.

## Context

Depends on: `feature_context_panel_infrastructure.md` and `feature_context_panel_modes_sections.md`. Once the hook, shared components, modes, and sections exist, this task wires everything together by creating the top-level `ContextPanel.tsx`, replacing the old `RightPanel` in `AppShell`, and cleaning up obsolete state.

See [CONTEXT_PANEL.md](../../frontend/ui-specs/CONTEXT_PANEL.md) for the full design.

## Plan

1. Create `ContextPanel.tsx` in `frontend/src/components/ContextPanel/`
   - Import `useContextMode` hook
   - Render a small mode indicator at the top (icon + mode name, e.g., "Spec Context")
   - Switch on mode to render the appropriate mode component:
     - `'spec'` → `<SpecContext />`
     - `'agent'` → `<AgentContext />`
     - `'code'` → `<CodeContext />`
     - `'empty'` → empty welcome state (inline div, no separate component)
   - Wrap in a scrollable container with `ContextPanel.css` styles
   - Export as named export

2. Update `AppShell.tsx`
   - Replace `<RightPanel />` import with `<ContextPanel />`
   - Keep the same panel wrapper div and resize handle behavior
   - Keep `rightPanelCollapsed` toggle working

3. Update `uiStore.ts`
   - Remove `rightActiveTab` state and `setRightTab` action (no more tabs)
   - Remove the `RightTab` type
   - Keep `rightPanelCollapsed` and `toggleRightPanel` (panel collapse still works)
   - Update localStorage persistence to remove `rightActiveTab`

4. Update keyboard shortcuts
   - `Cmd+J` still toggles right panel visibility (no change)
   - Remove or repurpose `Cmd+G` (was "focus graph tab") and `Cmd+P` (was "focus spec tab") — these no longer make sense with auto-switching
   - If shortcuts reference `setRightTab`, remove those references

5. Clean up old imports
   - Remove `ConsoleView` import from anywhere that referenced it via RightPanel
   - Remove `DiffView` import from RightPanel context (DiffView may still be used elsewhere)
   - Keep `GraphView` importable (it's now used inside `ConnectedSpecs`)

## Files to create
- `frontend/src/components/ContextPanel/ContextPanel.tsx` (top-level component)

## Files to modify
- `frontend/src/components/AppShell/AppShell.tsx` — swap RightPanel → ContextPanel
- `frontend/src/store/uiStore.ts` — remove rightActiveTab, RightTab type, setRightTab
- `frontend/src/utils/keyboard.ts` (if it exists) — remove tab-switching shortcuts

## Files to delete (optional)
- `frontend/src/components/AppShell/RightPanel.tsx` — replaced by ContextPanel (or keep as dead code for reference during transition)

## Files to read (for reference)
- `frontend/src/components/AppShell/AppShell.tsx` — current integration point
- `frontend/src/components/AppShell/RightPanel.tsx` — what we're replacing
- `frontend/src/store/uiStore.ts` — state to clean up
- `frontend/src/components/AppShell/AppShell.css` — panel styles to preserve

## Definition of done
- `ContextPanel` renders in the right panel position, auto-switching modes correctly
- No tabs visible in the right panel
- `Cmd+J` still toggles right panel collapse
- Panel resizing still works via drag handle
- No TypeScript errors or broken imports
- Old `RightPanel.tsx` is removed or clearly marked as deprecated
- `uiStore` no longer has `rightActiveTab` or `setRightTab`
- App builds and runs without errors: `npm run lint` and `npm run dev` pass

**Priority:** High
**Started:** 2026-03-04
