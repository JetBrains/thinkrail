---
id: submodule-server-auth
type: submodule-design
status: active
title: auth — provider auth surface (pi OAuth bridge + jbcentral wizard)
parent: module-server
depends-on: [module-contracts, module-shared]
references: [submodule-server-agent, task-provider-auth-ux]
tags: [v1, auth]
---

## Responsibility

The host side of the provider-auth UX (the connect gate + Settings→Providers): the `auth.status`
read, the pi OAuth login bridge, API-key writes/sign-out, and the in-app jbcentral (JetBrains AI)
wizard. It turns pi's in-process `OAuthLoginCallbacks` and jbcentral's subprocess output into
serialized `AuthEvent` frames on the `auth.event` channel — the same bridge pattern as the
extension-UI dialogs, minus sessions (auth is app-level, so it gets its own channel + frame union
rather than riding the sessionId-keyed `pi.extensionUi` frames).

## Boundary

- **Owns:**
  - `status` — `buildAuthStatus()`: OAuth flows (featured tiles flagged) + the API-key catalog
    (every model provider except the OAuth-only ones; anthropic/openai appear in both — a
    subscription and a raw key are both valid ways in) with per-provider `AuthStatus`
    (never credential values), the jbcentral probe (`installed` = binary resolves, `wired` =
    models.json routes through the proxy — **no spawns**; login state is discovered by the wizard's
    own steps, never polled), and `modelCount` (what drives the gate).
  - `loginFlow` — `startOAuthLogin(providerId)` runs `authStorage.login` mapping callbacks →
    events: `onAuth`→`auth-url` (+ best-effort host-side `openBrowser`), `onDeviceCode`→
    `device-code`, `onPrompt`/`onSelect`/`onManualCodeInput`→ blocking `prompt`/`select`/
    `manual-code` frames answered via `auth.answer` (requestId-correlated; a dismissed prompt
    cancels the flow, a dismissed select maps to pi's undefined-cancel, a dismissed manual-code
    re-arms — the browser callback may still win the race).
  - `jbcentralFlow` — the wizard steps as flows: `install` (runs the official installer **only
    after the UI's consent click**; fast-paths when already present; re-resolves the binary from
    well-known dirs since the installer edits the user's shell rc, not our PATH), `login` (spawns
    `jbcentral login`; browser opens host-side; first printed URL mirrored as `auth-url`),
    `configure` (`add claude` + `add codex` + `wireJbcentralProxy` + registry reload). Every spawn
    is timeboxed (install 5m / login 10m / add 2m), streams `log` lines (capped, error tail kept),
    and fails as a retryable `done ok:false` — an external CLI we don't control must never hang a
    flow. `unwireJbcentral` (Settings) is a direct call, not a flow.
  - `flows` — the one-at-a-time flow registry: starting any flow aborts the previous (last click
    wins), `done` is emitted exactly once per flow, `auth.cancel` aborts by id.
  - `credentials` — `setApiKey` (the ONE write carrying a credential value; stored via
    `authStorage.set`, never read back), `logoutProvider`.
  - `refresh` — `refreshAuthAndModels()`: `authStorage.reload()` + `modelRegistry.refresh()` +
    broadcast `{ kind:"changed", modelCount }` — what closes the gate reactively.
  - `events` — the `setAuthEventPublisher` seam `host` wires to the `auth.event` channel.
- **Public surface (barrel):** `buildAuthStatus`, `startOAuthLogin`/`answerAuth`/`cancelAuthFlow`,
  `setApiKey`/`logoutProvider`, `startJbInstall`/`startJbLogin`/`startJbConfigure`/
  `unwireJbcentral`, `refreshAuthAndModels`, `setAuthEventPublisher` (+ publisher type), `cancelFlow`.
- **Allowed deps:** `agent` (the shared `getPiRuntime()` — one `AuthStorage`/`ModelRegistry`),
  `@thinkrail/shared/jbcentral` (the wiring core shared with `thinkrail jbcentral`), `contracts`
  (`AuthEvent`/`AuthStatusResult`/…), Bun/Node.
- **Forbidden:** `host`; other sibling features; `@earendil-works/pi-coding-agent` directly (the
  runtime comes through `agent`'s barrel).

## Get right

- **Credential values never leave the host** on the read side; `auth.setApiKey` is the one
  client→host write. Status rows carry `configured`/`source`/`label` only.
- The installer runs **only** from an explicit `jbcentral.install` call — the UI shows the exact
  command and gets a consent click first; the host never auto-installs.
- Flow lifecycle: every start publishes `flow-started`; every path settles with exactly one
  `done`; aborts settle in-flight questions (no promise leaks); superseded flows abort cleanly.
- After ANY successful change (OAuth done, key set, logout, wire/unwire), refresh the runtime and
  broadcast `changed` — clients re-fetch `auth.status` + `model.list`; the gate closes/reopens on
  `modelCount`, so a stale registry means a lying gate.
