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

Own the web client's optional native desktop update capability and its shared presentation. Ordinary
browser deployments have no capability and render no update controls; native platforms expose the same
settings surface without teaching panels about launchers or native runtimes.

## Boundary

- **Owns:** discovery of the optional `__THINKRAIL_NATIVE_UPDATES__` bridge; one local external-store
  controller over its snapshot, actions, and subscription; centralized presentation derivation; the
  Update settings content; and the durable shell affordance shown while an update is ready.
- **Public surface (`index.ts`):** capability/controller hooks plus the Update settings and ready-affordance
  components consumed by the shell.
- **External deps:** React, Remix Icon, and `@thinkrail/contracts` types only. Native runtime packages never
  enter the browser bundle.
- **Forbidden:** Electron/Electrobun imports; host transport or WS calls; server/shared/pi imports; putting
  updater state in the global domain store; launcher-name checks; draft saving, input protection, renderer
  preparation, or any second restart-consent step.

The controller subscribes before its initial `getState()` and accepts native snapshots only when their
revision is at least the newest revision already observed. This makes an initial push win over a stale read.
The subscription stays local to this capability rather than joining server hydration. Action rejections are
captured into the local snapshot, so event handlers never create unhandled promises and the settings surface
can offer retry.

The settings content shows installed version and channel, current availability/progress/error, manual Check
for Updates or Retry, and—only when ready—Restart to Update plus Later. Restart is the sole user consent and
calls the bridge directly; Later only closes the current surface. It never installs, prepares, or changes
ordinary quit behavior. The shell's ready affordance remains visible after Later until native state ceases to
be ready, keeping a background download durable and discoverable.
