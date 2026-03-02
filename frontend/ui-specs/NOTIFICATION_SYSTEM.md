# Notification System — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-03-02

## Overview

Cross-cutting notification system for background session alerts. Combines toast notifications, tab badges, status bar indicators, and optional sound to keep users aware of events in non-active sessions.

## Component Hierarchy

```
<ToastContainer>                     // fixed bottom-right, stacks toasts
  <Toast /> ...                      // individual notification cards (max 5)
</ToastContainer>
<SessionTabBadge />                  // per-tab alert dot (in session tab bar)
<StatusBarAlert />                   // "⚠ N need attention" in status bar
```

## Toast Notifications

### Stack Behavior

- **Max visible:** 5 toasts simultaneously
- **Position:** fixed bottom-right, 16px from edge, above status bar
- **Stack direction:** newest at bottom, older toasts pushed upward
- **Overflow:** when 6th toast arrives, oldest auto-dismisses

### Auto-Dismiss Rules

| Event Type | Dismiss After | Persist? |
| --- | --- | --- |
| `agent/done` | 5 seconds | No |
| `agent/error` | 8 seconds | No |
| `agent/askUserQuestion` | Never | Yes — until user responds or switches to session |
| `agent/confirmAction` | Never | Yes — until user responds or switches to session |
| `agent/notification` | 4 seconds | No |

Persistent toasts (questions/approvals) stay visible until the user either:
- Clicks the toast → switches to that session
- Responds to the question/approval in the active session
- Manually dismisses via ✕ button

### Toast Layout

```
┌──────────────────────────────────────┐
│  ● architecture                   ✕  │
│  Session completed — $0.12 · 8t      │
└──────────────────────────────────────┘
```

| Element | Description |
| --- | --- |
| Status dot | Colored by event type (see colors below) |
| Session name | Bold, `--text` |
| Message | Brief description, `--muted` |
| Close button | `✕`, dismiss toast |

### Toast Colors

| Event | Dot Color | Border Highlight |
| --- | --- | --- |
| `agent/done` | `--green` | none |
| `agent/error` | `--red` | `--red` left border |
| `agent/askUserQuestion` | `--purple` (pulsing) | `--purple` left border |
| `agent/confirmAction` | `--gold` (pulsing) | `--gold` left border |
| `agent/notification` | `--blue` | none |

### Click Behavior

Clicking a toast:
1. Switches to the toast's session tab
2. If the toast is for a question/approval, scrolls chat to the pending card
3. Dismisses the toast

## Tab Badges

Small colored dot on non-active session tabs when they need attention.

| Event | Badge Color | Animation |
| --- | --- | --- |
| `agent/askUserQuestion` | `--purple` | `pulse 1.4s infinite` |
| `agent/confirmAction` | `--gold` | `pulse 1.4s infinite` |
| `agent/done` | `--green` | `pulse 1.4s infinite` (3 cycles then static) |
| `agent/error` | `--red` | `pulse 1.4s infinite` (3 cycles then static) |

- Badge appears only on non-active tabs
- Badge clears when user switches to that tab
- Multiple events: highest priority wins (question > approval > error > done)

## Status Bar Indicator

When any session has pending user input:

```
⚠ 2 sessions need attention
```

- Shown in status bar, left of keyboard hints
- Color: `--gold`
- Count reflects sessions with pending `askUserQuestion` or `confirmAction`
- Hidden when no sessions need attention

## Sound

Optional audio notification for pending user input.

| Setting | Default | Description |
| --- | --- | --- |
| `notifications.sound` | `false` | Enable/disable notification sounds |
| `notifications.soundOnlyPending` | `true` | Only play sound for questions/approvals, not completions |

- Sound: short, subtle ping (200ms, low volume)
- Plays once per event, not repeatedly
- Configurable via settings (future: settings panel)

## Notification Priority

When multiple events arrive simultaneously, process in this order:

1. `agent/askUserQuestion` (highest — requires user input)
2. `agent/confirmAction`
3. `agent/error`
4. `agent/done`
5. `agent/notification` (lowest)

## State

```typescript
interface NotificationState {
  toasts: Toast[];
  tabBadges: Map<string, TabBadge>;     // taskId → badge info
  pendingInputCount: number;             // sessions needing user input
  soundEnabled: boolean;
}

interface Toast {
  id: string;
  taskId: string;
  sessionName: string;
  eventType: string;
  message: string;
  persistent: boolean;
  createdAt: number;
}

interface TabBadge {
  color: string;
  eventType: string;
  pulsing: boolean;
}
```

## Animation

- Toast enter: `slideUp` from right edge (250ms ease-out)
- Toast exit: fade out + slide right (200ms)
- Stack reflow: other toasts slide up/down smoothly (150ms)

## CSS Classes

| Class | Element |
| --- | --- |
| `#toast-container` | Fixed container |
| `.toast` | Individual toast |
| `.toast.persistent` | Question/approval toast (no auto-dismiss) |
| `.toast .toast-dot` | Status dot |
| `.toast .toast-dot.question` | Purple pulsing |
| `.toast .toast-dot.done` | Green |
| `.toast .toast-dot.error` | Red |
| `.toast .toast-title` | Session name |
| `.toast .toast-msg` | Event message |
| `.toast .toast-close` | Dismiss button |
| `.alert-badge` | Tab badge dot |
| `.alert-badge.question` | Purple badge |
| `.alert-badge.done-alert` | Green badge |
| `.sbar-alert` | Status bar attention indicator |

## Known Limitations

- **No notification history:** Dismissed toasts are gone — no notification center or log to review past alerts
- **No per-session sound config:** Sound is global on/off — cannot set different sounds per event type
- **Browser tab must be open:** No OS-level push notifications — alerts only show within the app

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §3
- **Depends on:** [State Management](../src/store/README.md) (notificationStore), [API Client](../src/api/README.md) (agent event subscriptions)
- **Related:** [Chat UI](CHAT_UI.md) (question/approval cards trigger alerts), [Session History](SESSION_HISTORY.md) (done events)
