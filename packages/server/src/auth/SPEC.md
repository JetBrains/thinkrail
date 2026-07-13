---
id: submodule-server-auth
type: submodule-design
status: active
title: auth — provider status + in-app login
parent: module-server
depends-on: [module-contracts, module-shared]
references: [submodule-server-agent]
tags: [v1, auth, pi]
---

## Responsibility

Everything about **model-provider credentials**: the read side the Welcome strip renders
(`provider.status`) and the write side that configures them from inside the app — OAuth sign-in, single
API-key entry, and logout. All of it goes through pi's `AuthStorage` (on the shared runtime); we never
parse `auth.json` / `models.json` ourselves and never surface a credential value over the wire.

## Boundary

- **Owns:**
  - `providerStatus` — `getProviderStatus()` → the wire `ProviderStatusReport`: per-provider `configured`
    (pi's `hasAuth`-family truth, so env-var auth counts) + auth `kind` (oauth / api-key / env /
    **jbcentral** / other) + display name + the in-app-login capability flags **`canOAuth`/`canApiKey`**,
    configured-first. It **revalidates on every read** (`authStorage.reload()` + `modelRegistry.refresh()`)
    so a `pi` `/login` or `thinkrail jbcentral` run in a terminal — or an in-app mutation below — shows up
    on the next read without a host restart (accepted micro-risk: refreshing the shared registry concurrent
    with a streaming session — same as pi's TUI on `/login`). jbcentral wiring is detected from the
    registry's **effective** model `baseUrl`s via `shared/jbcentral`'s `isJbcentralProxyUrl` — never a
    separate `models.json` read. Assembly is a pure `buildProviderReport(sources)` over a narrow sources
    slice, unit-tested with fixture data.
    - **OAuth provider ids are first-class rows.** The id universe unions model-registry providers,
      stored-credential providers, **and** `authStorage.getOAuthProviders()` ids — because an OAuth id can
      differ from any model-provider id (`openai-codex` ≠ `openai`; `github-copilot` has no model row until
      authed). `canOAuth` = the row id is an OAuth provider (so `provider.loginStart(row.id)` uses the
      credential id pi will actually store under). `canApiKey` = the row is a **single-key** model provider,
      minus `MULTI_FIELD_PROVIDERS` (`amazon-bedrock`/`google-vertex`/`azure-openai-responses` — AWS/GCP/
      Azure creds aren't one string) and `OAUTH_ONLY_PROVIDERS` (`github-copilot`). These two small sets
      re-derive pi's private `isApiKeyLoginProvider` predicate, which isn't a package export (deep TUI
      import only) — **drift note:** re-check them on pi bumps against pi's provider-display-names map.
      `canLogout` = the id has a stored **auth.json** credential (`credentialProviders`) — the only auth the
      host can remove; env / jbcentral (models.json) / models.json-keyed auth report `false` (Sign-out would
      no-op, so the strip hides it).
  - `providerLogin` — the in-app credential **writes**, session-less (a login runs on the Welcome screen
    before any session exists), so a `loginId`-keyed sibling of `agent/webUiContext`:
    - `startLogin(providerId)` → `{ loginId }` **synchronously**; pi's `authStorage.login()` runs
      **detached** (an OAuth flow can take minutes — awaiting it would blow the client request timeout and
      block the WS pump). pi's login callbacks are wired to `LoginFrame` pushes on the `provider.login`
      channel: `onAuth`→`authUrl`, `onDeviceCode`→`deviceCode`, `onProgress`→`progress`,
      `onSelect`/`onPrompt`/`onManualCodeInput`→a parked `select`/`prompt` frame awaiting a reply. On
      success it **refreshes the registry** (pi's `login()` writes auth.json but doesn't touch the registry —
      skip this and the provider is authed-but-invisible) then pushes `success`; on throw, `error`.
    - `resolveLogin({ loginId, value })` — the browser's reply resolves the parked callback.
    - `cancelLogin(loginId)` — aborts the signal **and** settles the parked input with `undefined` (which
      throws inside `onPrompt`/`onManualCodeInput`), because the signal alone won't stop a provider's
      browser/callback-server wait; `cancelAllLogins()` sweeps them on host `stop()`.
    - `setProviderApiKey(id, key)` / `logoutProvider(id)` — `authStorage.set`/`logout` + a registry refresh.
    - `setLoginPublisher(fn)` — the server→client push seam (defaults to a no-op).
  - `jbcentral` — the in-app **JetBrains AI** (jbcentral proxy) wiring, composing `@thinkrail/shared/jbcentral`
    (which owns the protocol) and adding the one live-runtime step the standalone CLI can't:
    `connectJbcentral()` (`wireJbcentral` → on success `modelRegistry.refresh()` → a `JbcentralConnectResult`:
    connected / needs-install / needs-login / error), `disconnectJbcentral()` (`unwireJbcentral` + refresh),
    `jbcentralLogin()` (best-effort `jbcentral login` browser launch). `providerStatus` also surfaces
    `jbcentralInstalled` (via `isJbcentralInstalled`) **and `jbcentralInstall`** (the host's per-OS install
    one-liner, via `jbcentralInstall(process.platform)`) so the card knows its state — and shows the right
    command for the host's OS — from the one status read.
- **Public surface (barrel):** `getProviderStatus`, `buildProviderReport` (+ `ProviderStatusSources`);
  `startLogin`, `resolveLogin`, `cancelLogin`, `cancelAllLogins`, `setProviderApiKey`, `logoutProvider`,
  `setLoginPublisher`; `connectJbcentral`, `disconnectJbcentral`, `jbcentralLogin`.
- **Allowed deps:** `contracts` (wire types); `shared/jbcentral`; the **`agent` barrel** for
  `getPiRuntime()` (the shared `AuthStorage` + `ModelRegistry`); `@earendil-works/pi-ai/compat` (login
  callback **types** only).
- **Forbidden:** reaching into `agent` internals (only `getPiRuntime` via its barrel); importing `host` or
  any other sibling; deep-importing pi's TUI (`modes/interactive/*`) for its private provider constants;
  ever putting a credential **value** on the wire.

## Get right

- **`loginStart` must not `await` the flow** — return the handle, run `login()` detached.
- **Refresh the registry after every write** (login success / setApiKey / logout) or the change is invisible.
- **Cancel settles the parked promise**, not just `abort()`.
- Frames **accumulate** client-side (the `authUrl` + paste-`prompt` race), so a terminal `success`/`error`
  is what closes a flow — `terminate()` guarantees exactly one terminal outcome per `loginId`.

## Consumed by

`host` (wires all `provider.*` handlers + the `provider.login` channel publish); `agent` does **not** depend
on `auth` (the edge is one-way: `auth` → `agent` for `getPiRuntime`).
