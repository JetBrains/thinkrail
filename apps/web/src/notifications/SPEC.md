---
id: submodule-web-notifications
type: submodule-design
status: active
title: notifications — out-of-app attention notifications
parent: module-web
depends-on: [submodule-web-store, module-contracts]
---

## Responsibility

Raise out-of-app notifications when a worktree needs the user while ThinkRail is not focused — an agent
asks a question, finishes, or fails. The module is a **derived consumer** of session-state transitions:
it introduces no new source of truth, only the client-side pieces the store cannot know — window focus,
a collection window, browser permission, format, and the master toggle.

The trigger is a single signal: the **green attention dot lighting up**
(`needsInput !== null || completionUnread` rising from false to true, the same predicate
[[submodule-web-store]] uses). Every reason is covered uniformly — `ask_user_question`, ext-UI dialogs,
and an unread completion (`succeeded` / `failed` / `interrupted`). A user-cancelled run never sets
`completionUnread` on the host, so it never lights the dot and never notifies. The host already
collapses `agent_end` vs `agent_settled` into `completion`, so this module never listens to raw agent
events.

## Pipeline

Producer → queue → consumer, so the decision to notify is deferred to the moment it matters:

- **Observer** (`useAttentionNotifications`, mounted once by [[submodule-web-shell]]): subscribes to the
  store and feeds each rising edge to the engine. The store notifies on every mutation, so the hook
  gates on `sessionStateClock` before rebuilding candidates — streaming deltas never touch attention.
  The rising-edge decision itself is the pure `attentionObserver` (over `detectAttention`): it primes
  silently on the first installed snapshot and on every reconnect (`connectionGeneration` change) so a
  fresh `installSessionStateSnapshot` never storms.
- **Engine** (`attentionNotificationEngine`): a DOM-free queue with one global collection window
  (`ATTENTION_WINDOW_MS`, 1s). Accumulated edges flush as one batch; the latest event per session wins.
- **Consumer** (flush): emits only when every gate passes — master toggle on, channel permission granted,
  window **not** focused, and the session's dot **still lit** (already-answered edges are dropped). One
  surviving session opens its chat (`activateWorkspaceFromRoute`, landing at the latest message); several
  open the cross-workspace `SessionSwitcher` palette (`openSessionSwitcher` on [[submodule-web-store]]) so
  the user picks the one to attend, instead of landing in a window that may not show the right chat.
  `formatNotification` keeps the title as the bold **ThinkRail** mark, the worktree as `subtitle`, and the
  reason as `body` (`N worktrees need your attention` for several); a per-session `tag` lets the browser
  replace rather than stack.

## Channels

The consumer emits through a `NotificationChannel` (permission / requestPermission / show) that
`selectNotificationChannel()` picks by capability — suppression, format, queue, and settings stay
channel-agnostic above it:

- **Web** (`webNotifications`): the page Notifications API. It has no subtitle field, so it folds
  `subtitle · body` into one line, and uses the browser permission flow. It also sets the symbol-only
  ThinkRail icon (`/favicon.svg`, the browser-tab/shell-logo artwork), honored by Chrome/Edge/Firefox;
  Safari ignores a page notification's icon and shows its own. On mobile the constructor can throw
  (Android Chrome needs a Service Worker; iOS Safari needs an installed PWA) and is swallowed as a no-op.
- **Desktop** (`desktopNotifications`): the native OS channel via the frozen
  `__THINKRAIL_NATIVE_NOTIFICATIONS__` bridge ([[module-desktop]]), using `subtitle` as a distinct field.
  The OS owns permission, so `permission()` is always `granted` and the in-app preface never shows.
  Electrobun click callbacks are not landed yet, so a native notification carries no click action.

Selection is capability-detection only (the bridge's presence), never a `desktop` branch. No Service
Worker on either channel: a fully-closed app has no live client and raises nothing by design.

## Suppression

One rule: **window focused ⇒ never notify.** If the window holds focus the user is in ThinkRail and sees
the dot regardless of which workspace/chat is open, so no per-chat visibility check is needed.

## Permission

Permission is requested at the clearest user gesture. The primary, visible path is the Settings panel
(`panels/NotificationsSettings`): turning the toggle on, or clicking **Allow in browser** when permission is
still `default`, calls `Notification.requestPermission()` directly — present-user acquisition that does not
depend on an out-of-focus event (the panel also shows blocked/granted/unsupported status). For a client
that is already enabled, the in-app preface (`NotificationPermissionPrompt`) is the away-path fallback — shown
before the system request only on the first batch that would actually notify (passed suppression and the
toggle), lowering hard-deny risk. "Enable" calls `Notification.requestPermission()`; "Not now" snoozes for 7
days (`notificationPrompt`, browser-local in `localStorage`); a `denied` state never auto-prompts again and
surfaces a manual re-enable hint. Permission is per-browser, so the snooze is client-local, while the master
toggle is host-synced app config and defaults on (notifications still require the browser grant).

## Boundary

- **Owns:** the attention-notification pipeline, the `NotificationChannel` seam, and both channel
  implementations (browser Notifications API + the native desktop bridge wrapper).
- **Public surface (`index.ts` barrel):** `useAttentionNotifications`, `NotificationPermissionPrompt`,
  `selectNotificationChannel`, `NotificationChannel`, `NotificationPermissionState`, `ATTENTION_WINDOW_MS`.
- **Allowed deps:** [[submodule-web-store]] (session-state reads, prompt state, `activateWorkspaceFromRoute`
  and `openSessionSwitcher` actions), `ui` (the preface dialog), [[module-contracts]] (`SessionState` /
  `SessionCompletion` / `NativeNotificationBridge` types), React, Remix Icon.
- **Forbidden:** a second source of truth for attention; raw agent-event listening; any host/`pi` import;
  branching on `desktop` (channel choice is capability detection of the native bridge).

The master toggle (`notificationsEnabled`) lives in app config; its Settings panel is
`panels/NotificationsSettings`, not this module. Multi-client is accepted: focus is client-local, so one
agent event may notify in several connected clients independently.
