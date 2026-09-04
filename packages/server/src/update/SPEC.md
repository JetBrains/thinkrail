---
id: submodule-server-update
type: submodule-design
status: draft
title: update — release awareness + install orchestration
parent: module-server
depends-on:
  - module-contracts
references:
  - module-cli
  - module-desktop
  - module-ci-release
tags:
  - v1
  - public-surface-checked
---

## Responsibility

Everything about "a newer ThinkRail exists" that is **not** specific to how this host was installed:
the phase state machine, the check cadence, per-version banner dismissal, the persisted record, and
the status snapshot the clients render. How the newest build is *discovered* and *applied* is the
launcher's, injected as one narrow port — the shape `module-server`'s deployment obligation prescribes
for a second environment.

## The provider port

`UpdateProvider` is supplied by the launcher through `createServer`/`bootHost` options, the way
analytics provenance is. It answers three things and nothing else:

- `capabilities` — the wire's `UpdateCapabilities` **minus `restart`** (`Omit<…, "restart">`, so the
  shape is stated once, in `contracts`): `install` (false for a `0.0.0-dev` build or an install this
  host cannot replace), `channelSwitch`, and the channels it can offer.
- `check(signal)` → the newest release **this launcher could actually install**, or `null`.
- `install(target)` → `staged` (on disk, needs a restart) | `manual` (here is the command) |
  `failed`. One operation for upgrade, downgrade *and* channel switch — "get me to version V on
  channel C" — so a channel switch adds no second path anywhere.
- `restart?()` — optional. Absent means the user restarts; the wire's `capabilities.restart` is
  **computed here** from its presence, so a provider cannot claim a capability it lacks.

`apps/cli` implements it over the published installer; `apps/desktop` will implement it over
Electrobun's `Updater` (whose own metadata, not the GitHub tag list, is its truth). Neither
implementation may leak into this module: it never learns platforms, prefixes, install scripts, or
bundle formats.

## Boundary

- **Owns:** the `UpdateStatus` snapshot and its phase transitions
  (`idle`/`checking`/`available`/`installing`/`staged`/`error`); the single-flight + debounced check
  and its schedule (one check shortly after boot, then periodically while the host lives); the
  persisted record (`dismissedVersion`, `staged`, `lastCheckedAt`) under the data dir; the
  publisher-injection seam for the `update.status` channel; and the `updateChecksEnabled` tee the
  host feeds from the settings broadcast.
- **Public surface (barrel):** `startUpdates`, `stopUpdates`, `getUpdateStatus`, `checkForUpdate`,
  `installUpdate`, `dismissUpdate`, `setUpdatePublisher`, `setUpdateChecksEnabled`,
  `resetUpdateState`, `UpdateProvider`, `UpdateProviderCapabilities`, `InstallOutcome`.
- **Allowed deps:** `contracts` (`UpdateStatus`, `UpdateCapabilities`, `AvailableRelease`,
  `UpdateInstallTarget`, `ReleaseChannel` — the provider speaks the wire's shapes directly rather than
  a parallel set this module would have to map); `persistence` (the data dir for its record); `log`.
- **Forbidden:** `host` or any feature sibling; `shared/release` (feed knowledge belongs to the
  providers, not the orchestrator); anything from `apps/*`; owning the WS channel name or calling
  `track()` — both are `host`'s.

## Get right

- **Never advertise what cannot be applied.** `capabilities.install === false` ⇒ no check runs at
  all, so a source run and a locally compiled binary make no outbound request — which is also what
  keeps the default e2e suites network-free. The panel still reports the running version.
- **`staged` is persisted and self-clearing.** The new build sits on disk while the old host keeps
  running, so the banner must survive a page reload. A host whose own baked version already equals
  the staged one clears the record at boot: that restart happened.
- **A failed check is quiet.** It updates `error` inside the snapshot and nothing else — no toast, no
  retry storm. Only an explicit user action re-checks immediately.
- **Dismissal silences the banner, never the truth.** `dismissedVersion` is a client-rendering fact;
  the panel and the indicator keep reporting the available release.
- **No busy field.** Whether restarting is safe (streaming chats, live terminals) is already known by
  the client; deriving it a second time here would drift.
- The schedule is stopped by the host's `stop()`; a check in flight during shutdown is aborted, never
  awaited.
