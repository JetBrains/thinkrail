# Notification System — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-03-02

## Overview

Cross-cutting notification system for background session alerts. Combines toast notifications, tab badges, status bar indicators, and optional sound to keep users aware of events in non-active sessions.

## Component Hierarchy

```
<ToastContainer>                     // fixed bottom-right, stacks toasts
  <div.toast /> ...                  // individual notification cards (max 5)
</ToastContainer>
StatusBar                            // "{N} need attention" inline in status bar
```

`ToastContainer` is a standalone component rendered at the app root. The attention count is rendered inline within `StatusBar` — there are no separate `SessionTabBadge` or `StatusBarAlert` components.

## Toast Notifications

### Stack Behavior

- **Max visible:** 5 toasts simultaneously
- **Position:** fixed bottom-right, `var(--space-lg)` from edge
- **Stack direction:** `flex-direction: column-reverse` — newest at bottom, older toasts pushed upward
- **Overflow:** when 6th toast arrives, oldest is dropped (`.slice(-5)`)

### Auto-Dismiss Rules

| Event Type | Dismiss After | Persist? |
| --- | --- | --- |
| `success` | 5 seconds | No |
| `error` | 8 seconds | No |
| `question` | 10 seconds | No — auto-dismisses, or dismissed immediately when resolved |
| `approval` | 10 seconds | No — auto-dismisses, or dismissed immediately when resolved |
| `notification` | 5 seconds | No |

Question/approval toasts auto-dismiss after 10 seconds. They are also dismissed immediately when the user resolves the request (answers a question or approves/denies an action). Resolving a request also decrements `pendingInputCount` and clears the tab badge for that session.

### Toast Layout

```
┌──────────────────────────────────────┐
│  Session completed                x  │
└──────────────────────────────────────┘
```

Each toast is a single row with:

| Element | CSS Class | Description |
| --- | --- | --- |
| Left border | inline `borderLeftColor` | Colored by event type (see colors below) |
| Message | `.toast-message` | Single line, 12px, `--text` |
| Dismiss button | `.toast-dismiss` | x character, dismisses toast on click (with `stopPropagation`) |

There is no status dot, session name, or multi-line layout. The toast body is a flat `display: flex; align-items: center; justify-content: space-between` row.

### Toast Colors

The left border color is set via inline style from the `EVENT_COLORS` map:

| Event Type | Border Color |
| --- | --- |
| `question` | `var(--purple)` |
| `approval` | `var(--gold)` |
| `success` | `var(--green)` |
| `error` | `var(--red)` |
| `notification` | `var(--blue)` |

If the event type is unrecognized, the border falls back to `var(--border)`.

### Click Behavior

Clicking a toast:
1. If the toast has a `taskId`, switches to that session via `sessionStore.switchSession`
2. Dismisses the toast

## Tab Badges

Small colored indicator on non-active session tabs when they need attention.

| Event | Badge `type` | `pulsing` |
| --- | --- | --- |
| `agent/askUserQuestion` | `"question"` | `true` |
| `agent/confirmAction` | `"approval"` | `true` |
| `agent/done` | `"done"` | `false` |
| `agent/error` | `"error"` | `false` |

- Badge appears only on non-active tabs
- Badge clears when user switches to that tab
- Multiple events: latest event overwrites the previous badge for that `taskId`

## Status Bar Indicator

When any session has pending user input, the following is rendered inline in `StatusBar`:

```
{N} need attention
```

- Rendered as a `<span className="status-attention">` inside the status bar's left section, separated by `<span className="status-sep" />`
- Only visible when `pendingInputCount > 0`
- No warning symbol — plain text count
- Count is managed by `incrementPendingInput()` / `decrementPendingInput()` in the notification store

## Sound

Optional audio notification for pending user input.

| Setting | Default | Description |
| --- | --- | --- |
| `notifications.sound` | `false` | Enable/disable notification sounds |

- Sound: short, subtle ping (200ms, low volume)
- Plays once per event, not repeatedly
- `soundEnabled` is persisted via Zustand `persist` middleware (storage key `"bonsai-notification-sound"`)
- Toggled via `toggleSound()` action

## Notification Priority

When multiple events arrive simultaneously, process in this order:

1. `agent/askUserQuestion` (highest — requires user input)
2. `agent/confirmAction`
3. `agent/error`
4. `agent/done`
5. `agent/notification` (lowest)

## State

```typescript
interface Toast {
  id: string;
  taskId?: string;                    // optional — links toast to a session
  eventType: "question" | "approval" | "notification" | "error" | "success";
  message: string;
  persistent: boolean;
  createdAt: number;
}

interface TabBadge {
  type: "question" | "approval" | "done" | "error";
  pulsing: boolean;
}

interface NotificationStore {
  toasts: Toast[];
  tabBadges: Map<string, TabBadge>;     // taskId -> badge info
  pendingInputCount: number;             // sessions needing user input
  soundEnabled: boolean;

  addToast: (toast: Omit<Toast, "id" | "createdAt">) => void;
  dismissToast: (id: string) => void;
  setBadge: (taskId: string, badge: TabBadge) => void;
  clearBadge: (taskId: string) => void;
  incrementPendingInput: () => void;
  decrementPendingInput: () => void;
  toggleSound: () => void;
}
```

Toast IDs are generated sequentially (`toast-1`, `toast-2`, ...) via a module-level counter.

## Event Wiring

Toasts and badges are created in `wireEvents.ts` when agent lifecycle events arrive:

| RPC Event | Toast `eventType` | Toast Message | Persistent | Badge `type` | Badge `pulsing` |
| --- | --- | --- | --- | --- | --- |
| `agent/done` | `"success"` | `"Session completed"` | No | `"done"` | `false` |
| `agent/error` | `"error"` | `"Session error"` | No | `"error"` | `false` |
| `agent/askUserQuestion` | `"question"` | `"Agent has a question"` | Yes | `"question"` | `true` |
| `agent/confirmAction` | `"approval"` | `"Approve: {toolName}"` | Yes | `"approval"` | `true` |

Questions and approvals also call `incrementPendingInput()` to update the status bar count.

## Animation

- **Toast enter:** horizontal slide from right — `translateX(20px)` to `translateX(0)`, with opacity 0 to 1 (250ms ease-out, `@keyframes toastIn`)
- **Toast exit:** not implemented (toast is removed from DOM immediately)
- **Stack reflow:** not implemented (no transition on position changes)

## CSS Classes

| Selector | Element |
| --- | --- |
| `.toast-container` | Fixed container, bottom-right, `z-index: 1200`, max-width 320px |
| `.toast` | Individual toast — flex row, `--panel` background, 3px left border, rounded corners, shadow |
| `.toast:hover` | Hover state — `--hover` background |
| `.toast-message` | Message text — 12px, `--text` color, `flex: 1` |
| `.toast-dismiss` | Dismiss button — transparent background, `--hint` color, 14px font |
| `.toast-dismiss:hover` | Dismiss hover — `--text` color |
| `.status-attention` | Status bar attention text (inline in `StatusBar`) |

## Known Limitations

- **No notification history:** Dismissed toasts are gone — no notification center or log to review past alerts
- **No per-session sound config:** Sound is global on/off — cannot set different sounds per event type
- **Browser tab must be open:** No OS-level push notifications — alerts only show within the app
- **No exit animation:** Toasts disappear instantly when dismissed
- **No stack reflow animation:** Remaining toasts snap into position when one is removed

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §3
- **Depends on:** [State Management](../src/store/README.md) (notificationStore), [API Client](../src/api/README.md) (agent event subscriptions)
- **Related:** [Chat UI](CHAT_UI.md) (question/approval cards trigger alerts), [Session History](SESSION_HISTORY.md) (done events)
