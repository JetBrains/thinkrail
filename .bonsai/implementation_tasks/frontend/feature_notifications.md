---
id: task-fe-notifications
type: task-spec
status: done
title: Implement Notification System
depends-on:
- task-fe-state-management
implements:
- notification-system
covers:
- frontend/src/components/Notifications/
tags:
- medium
- new-feature
- frontend
---
# Implement Notification System

> Toast notifications, tab badges, and status bar alerts for background sessions

**Status:** Done
**Priority:** Medium
**Depends on:** `feature_state_management`, `feature_app_shell`
**Spec reference:** `frontend/ui-specs/NOTIFICATION_SYSTEM.md`

## Summary

Cross-cutting notification system that keeps users aware of events in non-active sessions. Combines toast notifications (slide-in cards), session tab badges (colored dots), and status bar indicators.

## Files to Create

- `frontend/src/components/Notifications/ToastContainer.tsx` — fixed bottom-right stack, max 5 toasts, FIFO ordering
- `frontend/src/components/Notifications/Toast.tsx` — individual toast card: session name, event type, message, dismiss button
- `frontend/src/components/Notifications/TabBadge.tsx` — colored pulsing dot overlay on session tabs
- `frontend/src/components/Notifications/StatusBarAlert.tsx` — status bar indicator: "N sessions need attention"

## Key Implementation Details

### Auto-Dismiss Rules
| Event Type | Dismiss |
|-----------|---------|
| `agent/done` | 5 seconds |
| `agent/error` | 8 seconds |
| `agent/askUserQuestion` | Persistent (until answered) |
| `agent/confirmAction` | Persistent (until answered) |

### Tab Badge Colors
- Purple: question pending (`agent/askUserQuestion`)
- Gold: approval pending (`agent/confirmAction`)
- Green: session completed (`agent/done`)
- Red: error (`agent/error`)

## Definition of Done

- [ ] Toasts slide in from bottom-right on background session events
- [ ] Toasts auto-dismiss per rules, persistent for pending input
- [ ] Clicking a toast switches to that session
- [ ] Tab badges show colored dots for background session events
- [ ] Status bar shows pending attention count
- [ ] Max 5 toasts displayed simultaneously
