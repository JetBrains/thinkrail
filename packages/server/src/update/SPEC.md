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

- `capabilities` — the wire's `UpdateCapabilities` verbatim: `install` (false for a `0.0.0-dev` build
  or an install this host cannot replace), `channelSwitch`, and the channels it can offer.
- `installationId` — an opaque, stable identity for **the installation this provider would replace**
  (the CLI names the binary path it owns). It exists because the record below lives in the shared
  `~/.thinkrail` data dir, which every launcher and every prefix on the machine can open.
- `check(signal)` → the newest release **this launcher could actually install**, or `null`.
- `install(target)` → `staged` (on disk, needs a restart) | `manual` (here is the command) |
  `failed`. One operation for upgrade, downgrade *and* channel switch — "get me to version V on
  channel C" — so a channel switch adds no second path anywhere.
There is deliberately **no restart in the port**: the CLI host does not restart itself, so a capability
for it would advertise something no wire method and no button can perform. The desktop task adds the
capability, the `update.restart` method and the UI action together — the same rule applies to
`channelSwitch`, whose only values today are the two the client can actually honour.

`apps/cli` implements it over the published installer; `apps/desktop` will implement it over
Electrobun's `Updater` (whose own metadata, not the GitHub tag list, is its truth). Neither
implementation may leak into this module: it never learns platforms, prefixes, install scripts, or
bundle formats.

## Boundary

- **Owns:** the `UpdateStatus` snapshot and its phase transitions
  (`idle`/`checking`/`available`/`installing`/`staged`/`error`); **one operation at a time** — checking
  and installing share a single slot, so a check cannot run under an install and a second install
  cannot start while one is in flight; the schedule (one check shortly after boot, then periodically
  while the host lives); the
  persisted record (`dismissedVersion`, `staged`, `lastCheckedAt`) under the data dir; the
  publisher-injection seam for the `update.status` channel; and the `updateChecksEnabled` tee the
  host feeds from the settings broadcast.
- **Public surface (barrel):** `startUpdates`, `stopUpdates`, `getUpdateStatus`, `checkForUpdate`,
  `installUpdate`, `dismissUpdate`, `setUpdatePublisher`, `setUpdateChecksEnabled`,
  `resetUpdateState`, `UpdateProvider`, `InstallOutcome`.
- **Allowed deps:** `contracts` (`UpdateStatus`, `UpdateCapabilities`, `AvailableRelease`,
  `UpdateInstallTarget`, `ReleaseChannel` — the provider speaks the wire's shapes directly rather than
  a parallel set this module would have to map); `persistence` (the data dir for its record); `log`.
- **Forbidden:** `host` or any feature sibling; `shared/release` (feed knowledge belongs to the
  providers, not the orchestrator); anything from `apps/*`; owning the WS channel name or calling
  `track()` — both are `host`'s.

## Rejected

- **Implementing both launchers here, branching on launcher identity.** It would drag Electrobun's
  `Updater` and the installer scripts into `packages/server`, invert the boundary, and leave
  `if (desktop)` in the shared core forever. The port costs ~100 lines per launcher instead.
- **Checking centrally (one GitHub-tag lookup for everyone) and only applying per launcher.** Desktop's
  installable truth is Electrobun's own metadata, so a central check would advertise releases the desktop
  app cannot apply — the failure the *never advertise what cannot be applied* invariant exists to stop.
- **A CLI host that restarts itself** (designed, then cut as not worth its cost): spawn a detached
  successor that re-binds the same port after a `<binary> --version` preflight. It works even when
  `thinkrail` was launched from inside another agent — the case that motivated wanting it — but it needs
  a port-reclaim bind mode, a process-handoff sequence, and a "the successor never came back" recovery
  path, all to save one click. A **supervisor process** owning the port across restarts was rejected with
  it: safest, but it doubles the process count and desktop would never use it. Nothing was left behind
  for either: a capability for restarting arrives with the wire method and the button that honour it,
  which is the desktop task's job (`Updater.applyUpdate()` gives it that for free).

## Get right

- **Never advertise what cannot be applied.** `capabilities.install === false` ⇒ no check runs at
  all, so a source run and a locally compiled binary make no outbound request — which is also what
  keeps the default e2e suites network-free. The panel still reports the running version.
- **`updateChecksEnabled` governs the *schedule*, not the method.** It stops the host polling on its
  own; `update.check` is defined on the wire as "force one check", so an explicit request is honoured
  whenever the provider can install. Folding the preference into both would have made a client's own
  action a silent no-op.
- **`staged` is persisted, scoped, and self-clearing.** The new build sits on disk while the old host
  keeps running, so the banner must survive a page reload — but the record lives in a data dir shared
  by every launcher and every installed copy, so it carries the `installationId` that staged it plus
  the version that was running then (`from`). A host reports only *its own* record, and **never
  deletes a foreign one**: a desktop host, a second prefix, or a source run that cannot install
  anything would otherwise show or destroy another installation's pending restart. Its own record is
  cleared at boot as soon as the running version is no longer `from` — whether that is the staged
  target (the restart happened) or something else entirely (the installation changed under us);
  either way the expectation is settled, which is what stops a "restart to finish" banner that can
  never come true.
- **A failed check is quiet.** It updates `error` inside the snapshot and nothing else — no toast, no
  retry storm. Only an explicit user action re-checks immediately.
- **An async result only lands if it is still the truth.** Every operation carries the module
  generation it started in plus a token for the slot it owns: a check superseded by an install (or by
  a `startUpdates()`) writes nothing and does not clear the phase, and a *finished install* still
  persists what it staged even when shutdown released its slot — losing that record would tell the
  user to restart into a build the host no longer knows about. Ownership guards the slot; the
  generation guards the writes.
- Installing **aborts an in-flight check** rather than queueing behind it: the check's answer is about
  to be superseded anyway, and the client must see `installing` immediately.
- **Dismissal silences the banner, never the truth.** `dismissedVersion` is a client-rendering fact;
  the panel and the indicator keep reporting the available release.
- **No busy field.** Whether restarting is safe (streaming chats, live terminals) is already known by
  the client; deriving it a second time here would drift.
- The schedule is stopped by the host's `stop()`; a check in flight during shutdown is aborted, never
  awaited.
