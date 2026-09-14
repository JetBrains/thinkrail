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

Own one application-update presentation over either local native update authority or an immutable host update
notice. The module normalizes those capabilities into one shell hook, one software-update settings surface, and
one durable ready/available affordance without teaching the UI which launcher is running.

## Boundary

- **Public surface (`index.ts`):** `useUpdates`, `UpdateSettings`, and `UpdateReadyButton`.
- **External deps:** React, Remix Icon, `@thinkrail/contracts` types, the sibling store barrel, and
  `components/ui`.
- **Forbidden:** Electron/Electrobun imports; server/shared/transport imports; launcher-name checks;
  renderer-selected feed URLs; update check/download/install logic; host-supplied shell commands; draft saving,
  input protection, renderer preparation, or any second restart-consent step.

The optional frozen `__THINKRAIL_NATIVE_UPDATES__` bridge remains the native authority. Its adapter subscribes
before its initial read, accepts monotonic revisions at one ingestion point, and wraps rejected requests as local
errors. Native snapshots remain shell-local and never enter Zustand. Native ready state exposes Restart to Update
and Later exactly once; Later closes the current surface but leaves the durable affordance visible until native
state ceases to be ready.

The optional host notice arrives through the versioned wire and is synchronized in the store. Its presence alone
is the capability signal: the notice remains visible through a temporary disconnect and the next welcome replaces
or clears it. It renders the fixed product command `thinkrail update` with explicit guidance to run it on the host
machine and then restart ThinkRail. The command is never supplied by the remote host. CLI mode has no Check,
Retry, Later, restart action, progress, error, status machine, or protocol-version subscription.

If both capabilities are present, native authority wins. With neither capability, the Updates settings section and
ready affordance are absent. One settings component varies only capability-specific copy and actions: desktop keeps
background-download/progress/restart behavior; a CLI host reports one available version and manual command
guidance.
