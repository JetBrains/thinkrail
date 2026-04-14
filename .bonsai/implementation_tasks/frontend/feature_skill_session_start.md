# Implement "Start the Session" Button for Skill-Loaded Sessions

> One-click button to launch a skill when a session is created with a skill selected.

**Status:** Done
**Priority:** Medium
**Depends on:** —
**Spec reference:** [features/SKILL_SESSION_START_DESIGN.md](../../features/SKILL_SESSION_START_DESIGN.md) | [frontend/ui-specs/SKILL_SESSION_START.md](../../frontend/ui-specs/SKILL_SESSION_START.md)

## Files Modified

- `frontend/src/components/SessionPanel/SessionPanel.tsx`
- `frontend/src/components/ChatStream/InputArea.tsx`

## Summary

When a session is created with a skill selected, the session has `skillId` set and `SKILL.md` loaded into the system prompt, but sits idle with 0 events. The existing "Continue" button requires `events.length > 0`, so the user has to manually type a message. This task adds a "Start: {skill name}" button that sends `"start"` to trigger the agent.

## Plan

| # | Step | File | Details |
|---|------|------|---------|
| 1 | Add `showStartSession` flag | `SessionPanel.tsx` | `!inputDisabled && !isRunning && events.length === 0 && skillId != null` |
| 2 | Add `handleStartSession` callback | `SessionPanel.tsx` | Sends `"start"` via existing `sendMessage` when status is idle |
| 3 | Pass props to InputArea | `SessionPanel.tsx` | `showStartSession`, `onStartSession`, `skillId` |
| 4 | Extend `InputAreaProps` | `InputArea.tsx` | Three optional props: `showStartSession`, `onStartSession`, `skillId` |
| 5 | Render start button | `InputArea.tsx` | In `.input-actions` div after Continue block; reuses `.input-continue` CSS |

## Definition of Done

- [x] `showStartSession` flag is derived correctly and mutually exclusive with `showContinue`
- [x] "Start: {skill name}" button appears when session has skill and no events
- [x] Button sends `"start"` message via existing pipeline
- [x] Button label resolves skill name from `SKILLS` constant
- [x] No button shown for sessions without a skill
- [x] "Continue" button still works for sessions with events
- [x] TypeScript type-check passes (`tsc --noEmit`)
- [x] No new CSS, types, store changes, or backend changes needed
