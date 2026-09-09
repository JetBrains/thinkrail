---
id: submodule-web-native-updates
type: submodule-design
status: active
title: nativeUpdates — optional desktop update capability
parent: module-web
depends-on: [module-contracts]
tags: [ui, desktop, updates]
---

## Responsibility

Own the web client's thin optional native desktop update shell integration and props-driven controls. Ordinary
browser deployments have no capability and render no update controls; native platforms expose the same settings
surface without teaching panels about launchers or native runtimes.

## Boundary

- **Owns:** discovery of the optional `__THINKRAIL_NATIVE_UPDATES__` bridge; one hook mounted by `Shell` that
  holds the latest native snapshot and wraps bridge actions; the props-driven Update settings content; and the
  props-driven durable shell affordance shown while an update is ready.
- **Public surface (`index.ts`):** the shell hook plus the Update settings and ready-affordance components.
- **External deps:** React, Remix Icon, and `@thinkrail/contracts` types only. Native runtime packages never
  enter the browser bundle.
- **Forbidden:** Electron/Electrobun imports; host transport or WS calls; server/shared/pi imports; putting
  updater state in the global domain store; launcher-name checks; draft saving, input protection, renderer
  preparation, or any second restart-consent step.

The hook subscribes before its initial `getState()` and applies the monotonic revision guard at that one ingestion
point, making an initial push win over a stale read. Its state stays local to `Shell` rather than joining server
hydration, Zustand, a provider, or an external store. Bridge request rejections become a visible local error while
native notifications remain authoritative; event handlers never create unhandled promises and the settings
surface offers a useful retry even when native status is still ready.

The settings content receives state and actions as props and shows installed version and channel, current
availability/progress/error, manual Check for Updates or Retry, and—only when ready—Restart to Update plus Later.
The compact affordance likewise receives props and renders only for ready state. Restart is the sole user consent
and calls the supplied action; Later only closes the current surface. It never installs, prepares, or changes
ordinary quit behavior. The shell's ready affordance remains visible after Later until native state ceases to be
ready, keeping a background download durable and discoverable.
