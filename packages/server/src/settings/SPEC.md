---
id: submodule-server-settings
type: submodule-design
status: active
title: settings — server-synced app config
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

The server-synced app config — OUR settings (an opaque theme selection, the remote-check knobs), an
extensible `AppConfig` bag. Reads/merges/persists it and fans changes out to every client, so a preference
set on one client follows the user to the others (architecture #9: shared domain state). The web client
owns the available theme manifests; settings stores only the selected string id. The `remotes` scheduler
(a later module) owns *acting* on `gitRemoteCheck`/`gitRemoteCheckIntervalMinutes` — this module owns only
storing, validating, and broadcasting them; `host`'s settings-publisher tee is what reaches the two together
(`settings` must never import `remotes`, nor vice versa).

## Boundary

- **Owns:** the cached current `AppConfig` (lazy-loaded, so the per-connect `getConfig()` for
  `server.welcome` doesn't hit disk each time); `getConfig()`, `updateConfig(partial)` (merge → validate the
  remote-check fields → persist → broadcast), the `setSettingsPublisher` seam, and `resetConfigCache()` (the
  e2e reset).
- **Public surface (barrel):** `getConfig`, `updateConfig`, `setSettingsPublisher`, `resetConfigCache`.
- **Allowed deps:** `persistence` (`loadConfig`/`saveConfig`), `contracts` (`AppConfig`, `DEFAULT_CONFIG`).
- **Forbidden:** importing `host` or any other sibling (including `remotes` — config reaches it only
  through `host`'s injected tee, the same inversion `setAnalyticsSending` already uses); owning WS
  channels — it emits a domain value through the injected publisher; `host` maps it onto `settings.changed`.
  **Not owned here:** the remote-trust ledger (`remotes.json`, server-only, `persistence`'s
  `isRemoteTrusted`/`noteRemoteTrusted`) never rides `AppConfig` or any RPC result — it is inference about
  the user's machine, not a setting a client reads or writes.

## Get right

- **Converge on the broadcast, no per-client optimism.** `updateConfig` persists then publishes; the
  initiating client applies on the `settings.changed` push like everyone else (the workspace-lifecycle
  pattern). `getConfig()` is the same value `server.welcome` seeds on connect.
- Theme availability/labels/palettes are not server settings concerns. An id unknown to a given web client
  remains persisted unchanged; that client owns visual fallback.
- **`AppConfig`'s fields are FLAT, never nested per-feature** (no `git: { mode, interval }`). `loadConfig()`
  (`persistence.ts`) is a **shallow** spread — `{ ...DEFAULT_CONFIG, ...readJson(...) }` — over
  `DEFAULT_CONFIG`. A nested object read from `config.json` would *replace* the whole nested value rather
  than merge into it, so a `config.json` written before a sibling key existed would silently drop that
  sibling the moment the user touched anything else under the same nested key. Every future settings field
  belongs at the top level for exactly this reason — do not "tidy" `gitRemoteCheck` /
  `gitRemoteCheckIntervalMinutes` into a `git: {…}` bag later; it would reintroduce the bug this note exists
  to prevent.
- **`updateConfig` validates the remote-check fields, and only those, via the named
  `clampRemoteCheckFields`** — never inline in `updateConfig`'s merge spread, so the rule is unit-testable
  on its own and visible as one name instead of buried arithmetic. `gitRemoteCheckIntervalMinutes` clamps to
  `[1, 1440]`; a non-finite value (`NaN`, `Infinity`) falls back to the *default* (`15`), not to a clamp
  bound — neither bound is a meaningful reading of "not a number". An unrecognised `gitRemoteCheck` value
  falls back to the default (`"probe"`) rather than disabling checks or throwing out of the settings tee —
  a partial from the wire is untrusted input (any connected client, buggy or hostile), and the rest of
  `updateConfig`'s keys still pass through unvalidated by design (this module is not a general schema
  validator; only these two fields have a failure mode worth guarding).
- **The remote-trust ledger is deliberately absent from this module and from the wire.** It is tempting to
  fold `remotes.json` into `AppConfig` since both are "remote-check state" — resist it: the ledger is
  server-only inference (which pairs a human has actually authenticated against), not a user-facing
  preference, and it must never ride `server.welcome`/`settings.changed` or any RPC result.
