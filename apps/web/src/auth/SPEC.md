---
id: submodule-web-auth
type: submodule-design
status: active
title: auth — in-app provider login UI
parent: module-web
depends-on: []
references: [submodule-web-store, submodule-web-chat]
tags: [v1, ui, auth]
---

## Responsibility

The client half of in-app provider login: the accumulating client-side **login-state types** and the
**presentational** OAuth dialog that renders them. The dialog is the exact analogue of `chat/ExtUiDialog` —
pi's flow, bridged over the wire, rendered as a modal — but **session-less**: a login runs on the Welcome
screen before any session exists. (Mirroring the `chat`/ExtUi split, the **frame reducer lives in `store`**,
not here — `auth` stays presentational + types, so nothing here imports `store`.)

## Boundary

- **Owns:**
  - `loginState` — the **types** `LoginState` (+ `LoginInput`/`LoginInputSelect`/`LoginInputPrompt`): the
    client-accumulated state of one login. Its doc pins the accumulation contract the store's reducer
    implements — frames **add**, they don't replace (`url` can be live alongside a paste `prompt`, the
    browser-vs-paste race), `status` goes `active → success/error`. **Types only** (like `chat/types`).
  - `LoginDialog` — **props-driven, no store/transport** (like the chat renderers): renders a `LoginState`
    (open-URL button + selectable URL, device code, a `select`/`prompt` input, progress/working spinner,
    terminal success/error) and calls back `onReply(value)` / `onCancel()` / `onClose()`. Themed with token
    utilities only; `lucide-react` icons; shadcn `Dialog`/`Button`.
- **Public surface (barrel `index.ts`):** `LoginDialog`; `LoginState`/`LoginInput*` (types).
- **Allowed deps:** `components/ui` (`Dialog`/`Button`). (The state types need no imports.)
- **Forbidden:** importing `store`/`transport` (the dialog stays presentational — the **panel** is the
  integration piece, exactly as `chat/ChatView` is for the chat renderers); any `pi`/`server` import.

## Integration (owned by the caller, not here)

- The **store** holds the single `activeLogin: LoginState | null` (flat, session-less) and owns the frame
  reducer (`foldLoginFrame`) — never under a session runtime (that path drops frames pre-session).
- The **`provider.login` channel** is routed to `store.applyLoginFrame` in `transport/wireTransport`.
- `panels/ProvidersSettings` (the Providers section of the Settings dialog) is the integration piece: it
  starts a login (`provider.loginStart` → `store.beginLogin`), mounts `LoginDialog` from `store.activeLogin`,
  wires `onReply`/`onCancel` to `provider.loginReply`/`loginCancel`, and re-fetches `provider.status` when a
  login (or api-key/logout) settles. (The Welcome screen only carries `panels/ProviderWarningBanner`, which
  opens Settings → Providers when no provider is connected.)

## Get right

- **Frames accumulate** — the reducer must not clobber `url` when a paste `prompt` arrives, or vice-versa.
- The dialog is mounted with `key={state.loginId}` so a new login gets fresh local (text/busy) state.
