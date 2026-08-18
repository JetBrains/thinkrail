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
    configured-first. It **revalidates on every read through `agent`'s admission coordinator**: the current
    generation refreshes local config/auth availability with network disabled, so an external PI login is
    visible without mutating a runtime concurrently with cutover. Central is not inferred from model URLs:
    status comes from `shared/jbcentral`'s executable/version/artifact postconditions plus the coordinator's
    active-or-pending generation state. An external global add/remove discovered here schedules the same
    serialized reconciliation path as an in-app action; until it applies, the report is truthfully pending.
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
    with the narrow `agent` runtime-generation coordinator; it never reaches manager internals. Connect is a
    staged transaction: compatible Central → exclusive admission and an `agent_settled` drain → `add pi`
    success and artifact postcondition → exact legacy cleanup → candidate generation validation →
    cutover/reattachment, all before admission reopens. A later failure restores only
    this invocation's cleanup fields when its compare-and-swap still holds, retains the old generation, and
    does not run `remove pi` as compensation unless ownership could be proven. Disconnect serializes
    `remove pi`, validates that every live session's exact persisted `{provider,id}` survives, and blocks or
    restores Central configuration rather than permit PI's fallback. Login launches `central login` only
    after the same exact-version preflight; update invokes `central update --install` so an older release can
    reach the reviewed version; all actions use the resolved absolute executable.

    One process-wide single-flight serializes connect/disconnect/update/reconciliation across browser clients.
    An action that begins while work is active closes admission, lets already accepted automatic work finish at
    `agent_settled`, reports `pending`, then applies in the background. If that background completion is
    model-blocked, the shared host status retains only the affected session ids so every client can link the
    user to a safe resolution. Opposite concurrent actions do not run side effects in parallel. A recovery
    admission seal survives failed repair attempts and opens only after a coherent generation is applied.
    Status and action results use only the closed contracts taxonomy—never child output, extension contents,
    diagnostics, proxy data, raw models, or arbitrary thrown messages.
- **Public surface (barrel):** `getProviderStatus`, `buildProviderReport` (+ `ProviderStatusSources`);
  `startLogin`, `resolveLogin`, `cancelLogin`, `cancelAllLogins`, `logoutProvider`,
  `setLoginPublisher`; `initializeJbcentralRuntime`, `getJbcentralStatus`, `connectJbcentral`,
  `disconnectJbcentral`, `updateJbcentral`, `jbcentralLogin`, and the applied-transition publisher seam.
- **Allowed deps:** `contracts` (wire types); `shared/jbcentral`; the **`agent` barrel** for the shared
  runtime/auth facade and narrow generation coordinator; `@earendil-works/pi-ai` (auth interaction **types** only).
- **Forbidden:** reaching into `agent` internals (runtime/auth and reconciliation only through its barrel); importing `host` or
  any other sibling; deep-importing pi's TUI (`modes/interactive/*`) for its private provider constants;
  ever putting a credential **value** on the wire.

## Get right

- **`loginStart` must not `await` the flow** — return the handle, run `login()` detached.
- **All runtime/auth reads and writes take coordinator admission.** Pi's login/logout synchronizes its own
  provider locally; status still refreshes the admitted current generation so external credential changes
  become visible. Central artifact drift never mutates the live runtime directly—it schedules reconciliation.
- **API keys persist only through `login(id, "api_key", interaction)`** — `setRuntimeApiKey` is a
  session-lifetime overlay and would silently drop the key on host restart. The interaction is the real
  dialog bridge, never a canned auto-answer (a canned one can only serve single-prompt providers).
- **Cancel settles the parked promise**, not just `abort()`.
- Frames **accumulate** client-side (the `authUrl` + paste-`prompt` race), so a terminal `success`/`error`
  is what closes a flow — `terminate()` guarantees exactly one terminal outcome per `loginId`.

## Consumed by

`host` (wires all `provider.*` handlers + the `provider.login` channel publish); `agent` does **not** depend
on `auth` (the edge is one-way: `auth` → `agent` through admitted runtime callbacks and the generation
boundary).
