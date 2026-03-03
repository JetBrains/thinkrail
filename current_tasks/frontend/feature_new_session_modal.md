# Implement New Session Modal

> Session creation form with skill selection and spec context picker

**Status:** Pending
**Priority:** High
**Depends on:** `feature_app_shell`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/NEW_SESSION_MODAL.md`

## Summary

The New Session Modal is the entry point for starting Claude agent sessions. Users select a skill from a grid, optionally pick specs as context, configure the session, and click "Start Session" which calls `agent/run`.

## Files to Create

- `frontend/src/components/NewSessionModal/NewSessionModal.tsx` — modal overlay with form steps
- `frontend/src/components/NewSessionModal/SkillGrid.tsx` — 12 skill cards grouped by purpose (foundation, creation, review, visualization)
- `frontend/src/components/NewSessionModal/SpecSelector.tsx` — multi-select dropdown with spec search, chip display for selected specs
- `frontend/src/components/NewSessionModal/AdvancedConfig.tsx` — collapsible section: model dropdown, max turns pills, permission mode radio

## Key Implementation Details

- Triggered by `+ New Session` button in header or `Cmd+T`
- Session name auto-suggested from skill + target spec
- Pre-fill supported when invoked from graph context menu (skill + spec pre-selected)
- On submit: calls `agent/run` RPC, creates session in sessionStore, opens new tab in center panel
- Form validates: skill required, name non-empty

## Definition of Done

- [ ] Modal opens on Cmd+T or header button click
- [ ] Skill grid shows all available skills with icons and descriptions
- [ ] Spec selector allows multi-select with search filtering
- [ ] Advanced config controls model, max turns, permission mode
- [ ] Start Session calls `agent/run` and creates a new session tab
- [ ] Pre-fill works when invoked from graph context menu
- [ ] Modal closes on Escape or backdrop click
