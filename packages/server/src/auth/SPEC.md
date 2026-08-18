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
(`provider.status`) and the write side that configures them from inside the app — OAuth sign-in,
interactive API-key entry (both over the **same login channel**, issue #97), and logout. All of it goes
through the shared `ModelRuntime` (pi's model/auth facade); we never parse `auth.json` / `models.json`
ourselves and never surface a credential value over the wire.

## Boundary

- **Owns:**
  - `providerStatus` — `getProviderStatus()` → the wire `ProviderStatusReport`: per-provider `configured`
    (pi's `hasAuth`-family truth, so env-var auth counts) + auth `kind` (oauth / api-key / env /
    other) + display name + the in-app-login capability flags **`canOAuth`/`canApiKey`**,
    configured-first. It **revalidates on every read through `agent`'s single runtime facade**: local
    config/auth availability refreshes with network disabled, so an external PI login becomes visible without
    reconstructing the runtime. Central is not inferred from model URLs: status combines
    `shared/jbcentral`'s executable/version/artifact postconditions with the Central state applied at host
    boot. If the global artifact later differs, status reports `restart-required`; it never mutates the live
    runtime or starts background reconciliation.
    Assembly is a pure `buildProviderReport(sources)` over a narrow sources slice, unit-tested with
    fixture data.
    - **OAuth-capable ids are first-class rows.** The id universe unions model-catalog providers,
      stored-credential providers (`listCredentials()`), **and** providers whose `Provider.auth.oauth`
      is present — an OAuth id can differ from any model-provider id (`openai-codex` ≠ `openai`), and a
      stored credential can outlive its models. `canOAuth` = the row's provider carries OAuth auth (so
      `provider.loginStart(row.id)` uses the credential id pi will actually store under); its row name
      prefers `auth.oauth.name` (more specific for oauth-only rows). `canApiKey` =
      **`Provider.auth.apiKey.login` exists** — pi's public api-key-login truth and *nothing else*
      (issue #97: the interactive login channel parks every prompt the provider asks, so multi-prompt
      creds — bedrock/vertex/azure — and OAuth+key providers — github-copilot — just work; the
      hand-maintained exclusion sets are gone; `openai-codex` reports `false` because pi's provider has
      no key auth, not because we said so). `canLogout` = the id has a stored
      **auth.json** credential (`credentialProviders`) — the only auth the host can remove; env / models.json-
      keyed auth report `false` (Sign-out would no-op, so the strip hides it). Central is represented only by
      the dedicated closed lifecycle, never inferred or attached to a provider row.
  - `providerLogin` — the in-app credential **writes**, session-less (a login runs on the Welcome screen
    before any session exists), so a `loginId`-keyed sibling of `agent/webUiContext`:
    - `startLogin(providerId, type = "oauth")` → `{ loginId }` **synchronously**; `runtime.login(id,
      type, interaction)` runs **detached** (a flow can take minutes — awaiting it would blow the client
      request timeout and block the WS pump). **One bridge, both auth types** (issue #97): `"oauth"` and
      `"api_key"` (the provider-owned interactive key entry — one secret prompt for most providers,
      multi-prompt for azure/vertex-style creds). pi's `AuthInteraction` is wired to `LoginFrame` pushes
      on the `provider.login` channel: `notify` `auth_url`→`authUrl`, `device_code`→`deviceCode`,
      `progress`/`info`→`progress` (info links appended as plain URLs); `prompt`
      `select`→a parked `select` frame, `text`/`secret`/`manual_code`→a parked `prompt` frame awaiting a
      reply (a `secret` prompt is flagged on the frame so the dialog masks the input). A prompt's own
      `signal` abort (pi cancelling the loser of its browser-vs-paste race) settles
      the parked input — identity-guarded so a late abort can't clear a newer parked prompt. pi persists
      the credential **and refreshes availability inside `login()`**, so success just pushes `success`;
      on throw, `error`.
    - `resolveLogin({ loginId, value })` — the browser's reply resolves the parked interaction.
    - `cancelLogin(loginId)` — aborts the signal **and** settles the parked input with `undefined` (which
      makes the awaiting `prompt` throw), because the signal alone won't stop a provider's
      browser/callback-server wait; `cancelAllLogins()` sweeps them on host `stop()`.
    - `logoutProvider(id)` — `runtime.logout` (refreshes internally). (The old `setProviderApiKey` — a
      canned interaction answering exactly one secret prompt — is gone with `provider.setApiKey`: the
      dialog flow subsumes it and also serves multi-prompt providers.)
    - `setLoginPublisher(fn)` — the server→client push seam (defaults to a no-op).
  - `jbcentral` — the in-app **JetBrains AI** native flow. It composes `shared/jbcentral`'s host-local adapter
    with `agent`'s one-time runtime initialization seam; it never reaches manager internals. Host boot probes
    Central before model work and asks `agent` to load the configured opaque artifact into the process's
    single runtime. If that extension load fails, boot retries without it, leaves other providers usable, and
    records a closed `load-failed` status; a failure of the plain runtime still fails startup.

    Connect performs the exact-version preflight, runs `central add pi`, validates artifact existence, and
    returns `restart-required`. Disconnect runs `central remove pi`, validates artifact absence, and likewise
    requires restart when the active process was booted with Central. Neither action changes the live runtime,
    drains work, reattaches sessions, preflights live models, compensates, rolls back, or migrates prior
    configuration. A Central-only transcript that is unavailable after restart fails exact model resolution;
    PI fallback is never allowed. Login launches `central login` after the same version preflight. Update
    invokes `central update --install`; if an artifact existed before update, it then runs `central add pi` to
    regenerate it with the newly reviewed version and requires restart. Every action uses the resolved absolute
    executable.

    One process-wide single-flight serializes connect/disconnect/update across browser clients. Actions are
    awaited directly—there is no background pending state. Artifact drift is reported as `restart-required`
    and never reconciled inside the process. Status and action results use only the closed contracts
    taxonomy—never child output, extension contents, diagnostics, proxy data, raw models, or arbitrary thrown
    messages.
- **Public surface (barrel):** `getProviderStatus`, `buildProviderReport` (+ `ProviderStatusSources`);
  `startLogin`, `resolveLogin`, `cancelLogin`, `cancelAllLogins`, `logoutProvider`,
  `setLoginPublisher`; `initializeJbcentralRuntime`, `getJbcentralStatus`, `connectJbcentral`,
  `disconnectJbcentral`, `updateJbcentral`, `jbcentralLogin`, and the successful-action publisher seam.
- **Allowed deps:** `contracts` (wire types); `shared/jbcentral`; the **`agent` barrel** for the shared
  runtime/auth facade and one-time runtime initialization; `@earendil-works/pi-ai` (auth interaction **types** only).
- **Forbidden:** reaching into `agent` internals (runtime/auth and initialization only through its barrel); importing `host` or
  any other sibling; deep-importing pi's TUI (`modes/interactive/*`) for its private provider constants;
  ever putting a credential **value** on the wire.

## Get right

- **`loginStart` must not `await` the flow** — return the handle, run `login()` detached.
- **All runtime/auth reads and writes use the process's single runtime facade.** Pi's login/logout synchronizes
  its own provider locally; status refreshes that same runtime so external credential changes become visible.
  Central artifact drift never mutates the live runtime—it requires restart.
- **API keys persist only through `login(id, "api_key", interaction)`** — `setRuntimeApiKey` is a
  session-lifetime overlay and would silently drop the key on host restart. The interaction is the real
  dialog bridge, never a canned auto-answer (a canned one can only serve single-prompt providers).
- **Cancel settles the parked promise**, not just `abort()`.
- Frames **accumulate** client-side (the `authUrl` + paste-`prompt` race), so a terminal `success`/`error`
  is what closes a flow — `terminate()` guarantees exactly one terminal outcome per `loginId`.

## Consumed by

`host` (wires all `provider.*` handlers + the `provider.login` channel publish); `agent` does **not** depend
on `auth` (the edge is one-way: `auth` → `agent` through the single runtime facade and initialization seam).
