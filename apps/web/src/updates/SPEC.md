---
id: submodule-web-updates
type: submodule-design
status: active
title: updates — optional application update capability
parent: module-web
depends-on: [module-contracts]
tags: [ui, updates]
---

## Responsibility

Own one application-update presentation over either local native update authority or a host-owned CLI update
lifecycle. The module normalizes those capabilities into one shell hook, one software-update settings surface,
and one durable status affordance without teaching the UI which launcher is running.

## Boundary

- **Public surface (`index.ts`):** `useUpdates`, `UpdateSettings`, `UpdateReadyButton`, and
  `UpdateInstallSurfaces`.
- **External deps:** React, Remix Icon, `@thinkrail/contracts` types, the sibling store barrel (host notice,
  toasts), `@thinkrail/ui` `button`/`dialog`/`utils`, and `@thinkrail/locales/react` for every user-visible string.
- **Forbidden:** Electron/Electrobun imports; server/shared/transport imports; launcher-name checks;
  renderer-selected feed URLs; update check/download/install logic; browser-supplied shell commands, paths,
  channels, versions, or URLs; draft saving, input protection, renderer preparation, or any second native
  restart-consent step.

The optional frozen `__THINKRAIL_NATIVE_UPDATES__` bridge remains the native authority. Its adapter subscribes
before its initial read, accepts monotonic revisions at one ingestion point, and wraps rejected requests with the
phase that failed. Native snapshots remain shell-local and never enter Zustand. Checks expose **Download** for an
available release; transfer progress becomes a distinct **Preparing update** phase before ready state exposes
**Install & Restart**. Closing Settings is the deferral action. Disabled/source native state exposes no section.
The UI calls the packaged `canary` identity **nightly** without changing feed selection.

The optional host snapshot arrives through the versioned wire and is synchronized in the store. It remains
visible through a temporary disconnect and the next welcome replaces or clears it. Current hosts expose
available/running/succeeded/failed state and one **Run Update** action; the action sends an empty version-gated
request and the host alone chooses and runs its update command. Success still asks for a manual host restart.
Older hosts retain fixed `thinkrail update` guidance. No command text or arbitrary diagnostics cross the wire.

A present native bridge always wins over host state, including while its capability is resolving or disabled.
With neither usable capability, the Updates settings section and affordance are absent. The topbar remains a path
back to Settings throughout actionable native and host phases, not only after a package is ready.

## Native install journey

`UpdateInstallSurfaces` is mounted once by Shell and is the only part that pushes toasts or calls
`dismissInstallResult`. The dialogs are props-driven and live in the main bundle. That matters because
the host socket closes during shutdown while the RPC bridge keeps working, so nothing they use may be a
lazy chunk. All wording is web-owned; desktop sends only data.
- **While `installing`:** a dialog that can't be dismissed. It shows the four steps (prepared, stopping,
  handoff, restarting) as a determinate bar, says up front that ThinkRail will close
  and reopen, and offers a log console with **Copy log**. It has no Cancel: Install & Restart was the
  consent, and quit stays coordinated. It closes as soon as the state leaves `installing`, so an error
  never traps the user.
- **`lastInstall: installed`:** one success toast with **Details**, then an immediate dismiss. Details
  opens from the web's own snapshot and shows the saved log plus **What's new**
  (`releases/tag/v<version>`).
- **`failed` / `unreported`:** a failure dialog, the Settings callout and the topbar chip "Update
  didn't install" stay until dismissed or retried.
  - The cause comes from the pure `installFailureCopy`. It is platform-neutral because this module
    doesn't detect platforms, and the raw installer text appears only in the console.
  - Recovery follows the live state rather than assuming the package survived the rollback: **Try
    again** when `ready`, **Download again** when `available`, **Check again** otherwise, and a
    disabled progress label while work runs. **Later** dismisses.
