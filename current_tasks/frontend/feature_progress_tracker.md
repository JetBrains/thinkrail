# Implement Progress Tracker

> Left panel dashboard: spec metrics, session tracker, activity timeline, cost

**Status:** Pending
**Priority:** Medium
**Depends on:** `feature_app_shell`, `feature_state_management`
**Spec reference:** `frontend/ui-specs/PROGRESS_TRACKER.md`

## Summary

The Progress tab in the left panel is the unified project health and session activity dashboard. It combines spec-driven metrics (progress bars), live session tracking, file change monitoring, activity timeline, and cost/budget management.

## Files to Create

### Frontend
- `frontend/src/components/ProgressTab/ProgressTab.tsx` — scrollable container with all dashboard sections
- `frontend/src/components/ProgressTab/SpecProgress.tsx` — spec completion bar (done/total %), status breakdown
- `frontend/src/components/ProgressTab/RequirementsProgress.tsx` — requirements coverage bar
- `frontend/src/components/ProgressTab/SourceCoverage.tsx` — source path coverage percentage
- `frontend/src/components/ProgressTab/ActiveSessions.tsx` — cards for each running session with live metrics
- `frontend/src/components/ProgressTab/ActivityTimeline.tsx` — compact vertical timeline of recent agent actions (max 50)
- `frontend/src/components/ProgressTab/FileChanges.tsx` — files modified across sessions (+ new, ~ modified, - deleted)
- `frontend/src/components/ProgressTab/CostBudget.tsx` — running cost, token count, budget bar with warning colors

### Backend (new RPC methods)
- `cost/summary` — get cost data
- `cost/setBudget` — set budget limit
- `cost/reset` — reset cost counters
- `cost/didUpdate` — notification when cost changes

## Definition of Done

- [ ] Progress tab renders in left panel
- [ ] Spec progress bar shows completion percentage
- [ ] Active sessions display with live status and metrics
- [ ] Activity timeline shows recent tool calls with timestamps
- [ ] File changes list is clickable (opens diff view)
- [ ] Cost display shows running total with optional budget bar
