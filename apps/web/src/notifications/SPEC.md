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
and completion with any outcome (`succeeded` / `failed` / `interrupted` / `cancelled`). The host already
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
- **Consumer** (flush): emits only when every gate passes — master toggle on, permission granted, window
  **not** focused, and the session's dot **still lit** (already-answered edges are dropped). One surviving
  session opens its chat (`activateWorkspaceFromRoute`, landing at the latest message); several focus the app. `formatNotification` keeps the title
  as the bold **ThinkRail** mark and puts the detail in the body (`{worktree} · {reason}` for one,
  `N worktrees need your attention` for several); a per-session `tag` lets the browser replace rather than
  stack. Every notification also sets the symbol-only ThinkRail icon (`/favicon.svg`, the
  browser-tab/shell-logo artwork), honored by Chrome/Edge/Firefox; Safari ignores a page notification's icon
  and shows its own browser icon (platform limitation).

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

- **Owns:** the attention-notification pipeline and the browser Notifications API wrapper
  (`webNotifications`). No Service Worker: a closed app has no live client and nothing to deliver, so a
  fully-closed app raises nothing by design. Cross-system: desktop Chrome/Edge/Firefox/Safari show the
  page-context notification; on mobile (Android Chrome needs a Service Worker, iOS Safari needs an
  installed PWA) the constructor can throw and is swallowed as a no-op rather than crashing the flush.
- **Public surface (`index.ts` barrel):** `useAttentionNotifications`, `NotificationPermissionPrompt`,
  `ATTENTION_WINDOW_MS`.
- **Allowed deps:** [[submodule-web-store]] (session-state reads, prompt state + `activateWorkspaceFromRoute`
  actions), `components/ui` (the preface dialog), [[module-contracts]] (`SessionState` / `SessionCompletion`
  types), React, Remix Icon.
- **Forbidden:** a second source of truth for attention; raw agent-event listening; any host/`pi` import.

The master toggle (`notificationsEnabled`) lives in app config; its Settings panel is
`panels/NotificationsSettings`, not this module. Multi-client is accepted: focus is client-local, so one
agent event may notify in several connected clients independently.
