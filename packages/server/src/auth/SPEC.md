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
    configured-first. It **revalidates on every read through `agent`'s current runtime facade**: local
    config/auth availability refreshes with network disabled, so an external PI login becomes visible.
    Central is not inferred from model URLs: status combines `shared/jbcentral`'s executable/version/artifact
    postconditions and closed auth/proxy observations with the synchronizer's latest desired/applied generation.
    Watcher drift schedules a rebuild; status is `configuring` until the newest candidate applies and
    `load-failed` when it cannot apply.

    **The auth/proxy observation is cached, refreshed off the read path, and never polled.** A settled
    `supported` reading serves the cached result immediately and, past `JBCENTRAL_STATUS_TTL_MS`, starts one
    background `central status` probe; when either verdict changes it publishes the ordinary provider
    invalidation, so an open card converges without any client timer. Only positively observed negatives set
    wire flags: `signed-out` sets `signedOut`, while a stopped proxy sets `proxyStopped` only on configured
    status; unknown never does. A refused `central add pi`, a launched `central login`, and a Start proxy
    attempt drop the shared cache because each can make the observation stale. An out-of-band change inside
    the TTL window is deliberately served stale until the next read past it. The probe never runs mid-action
    or while a rebuild is outstanding, so it cannot delay a Connect or a candidate cutover.
    Assembly is a pure `buildProviderReport(sources)` over a narrow sources slice, unit-tested with
    fixture data. Its runtime reads are restricted to the generation's provider-id allowlist captured before
    the opaque Central extension loads (after invariant host registrations): Central-owned provider objects,
    auth capabilities, credentials, and details never become ordinary provider rows or cross the wire.
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
    and artifact watcher with `agent`'s candidate-generation seam; it never reaches manager internals. Host boot
    starts the watcher and requests one initial generation before model work. A reviewed configured artifact is
    passed as an opaque extension path; absent or unsupported configuration produces a plain runtime. If the
    Central candidate fails at initial boot, auth records `load-failed` and asks agent for a plain runtime so
    the UI and unrelated providers remain usable; failure of that plain runtime still fails startup.

    Connect performs the minimum-version preflight, runs `central add pi`, validates artifact existence, and
    awaits the same rebuild path the watcher uses. Disconnect runs `central remove pi` and validates absence
    when the artifact exists; an already-absent artifact is the complete postcondition and rebuilds plain PI
    directly even if Central itself is now absent/unsupported (so Retry can repair a failed plain candidate).
    Login launches `central login` after the version preflight and drops the cached status
    observation, since the user is about to change it out of band; the launch is only reported as successful once
    the child has survived its grace period, so a login that cannot start surfaces as a failure with the host command as
    the fallback rather than as an invitation to finish in a browser that never opened.
    Update invokes `central update --install` and rechecks status. Start proxy invokes
    `central proxy start --ensure-updated`, invalidates the shared status observation, and validates that a
    fresh probe no longer positively reports stopped; it does not rebuild or reattach a PI runtime. Every
    action uses the resolved absolute executable. No action edits prior model configuration, preflights live
    chat models, compensates, or rolls back Central's global state.

    Watcher events are debounced/coalesced and each rebuild re-inspects the latest version + artifact
    postcondition. A monotonic request sequence prevents an older candidate from activating after a newer
    file event. On success, auth activates the candidate for provider/model reads and future sessions, clears
    `load-failed`, and publishes model/provider invalidation. Existing live sessions deliberately retain the
    runtime they were created with—including a Central-backed session after global Disconnect—until that
    session is disposed or the host restarts. They are never drained or reattached.

    A candidate failure retains the current runtime and reports `load-failed`; it never seals unrelated model
    actions. Retry, a later file event, or Disconnect requests another rebuild. One process-wide single-flight
    serializes CLI actions, while candidate requests coalesce to the newest observed artifact state. Status and
    action results use only the closed contracts taxonomy—never child output, extension contents, diagnostics,
    proxy data, raw models, or arbitrary thrown messages.
- **Public surface (barrel):** `getProviderStatus`, `buildProviderReport` (+ `ProviderStatusSources`);
  `startLogin`, `resolveLogin`, `cancelLogin`, `cancelAllLogins`, `logoutProvider`,
  `setLoginPublisher`; `initializeJbcentralRuntime`, `stopJbcentralRuntime`, `getJbcentralStatus`,
  `connectJbcentral`, `disconnectJbcentral`, `startProxyJbcentral`, `updateJbcentral`, `jbcentralLogin`, the successful-action /
  runtime-changed publisher seams, and the explicit `resetJbcentralStateForTests` lifecycle seam used by
  sibling host tests.
- **Allowed deps:** `contracts` (wire types); `shared/jbcentral`; the **`agent` barrel** for the current
  runtime/auth facade plus candidate prepare/activate; `@earendil-works/pi-ai` (auth interaction **types** only).
- **Forbidden:** reaching into `agent` internals (runtime and generation changes only through its barrel); importing `host` or
  any other sibling; deep-importing pi's TUI (`modes/interactive/*`) for its private provider constants;
  ever putting a credential **value** on the wire.

## Get right

- **`loginStart` must not `await` the flow** — return the handle, run `login()` detached.
- **Pre-session runtime/auth reads and writes capture the current generation.** Pi's login/logout synchronizes
  the captured runtime locally; live sessions keep their own generation. Artifact drift builds and atomically
  activates a new current generation without mutating either the candidate or existing sessions in place.
- **API keys persist only through `login(id, "api_key", interaction)`** — `setRuntimeApiKey` is a
  session-lifetime overlay and would silently drop the key on host restart. The interaction is the real
  dialog bridge, never a canned auto-answer (a canned one can only serve single-prompt providers).
- **Cancel settles the parked promise**, not just `abort()`.
- Frames **accumulate** client-side (the `authUrl` + paste-`prompt` race), so a terminal `success`/`error`
  is what closes a flow — `terminate()` guarantees exactly one terminal outcome per `loginId`.

## Consumed by

`host` (wires all `provider.*` handlers + the `provider.login` channel publish and stops the Central watcher);
`agent` does **not** depend on `auth` (the edge is one-way: `auth` → `agent` through the current-runtime and
candidate-generation seams).
