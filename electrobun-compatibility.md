---
id: electrobun-compatibility
type: architecture-design
status: draft
title: Electrobun compatibility — host adaptations and upgrade removal gates
parent: architecture
references: [module-desktop, submodule-desktop-updates, module-ci-release, module-artifact-tests]
tags: [electrobun, hutch, compatibility]
---

## Responsibility

The upgrade checklist for host code that compensates for a missing Electrobun API, an Electrobun or
Hutch defect, or a packaging constraint. Electrobun owns the native shell and Hutch its build
toolchain. Module specs own detailed rationale; this index records what an upgrade must re-check and
what would let us delete the adaptation. The installed versions come only from `apps/desktop/package.json`
(Electrobun) and the Hutch release that pin pairs with ([[module-desktop]] Build and release), not a second pin here.

## Last re-check

Electrobun 2.0.5 / Hutch 0.28.2, when this registry was created. Hutch `main` at
[`e044ccf`](https://github.com/blackboardsh/hutch/blob/e044ccf1d700e26a40aa9d11f9fa8698fc4a0e09/src/electrobun.zig#L3238)
(paired with Electrobun 2.0.7-beta.7) still archives the Linux installer's staging root; no other gate
was re-verified then.

## Upgrade contract

Every Electrobun upgrade checks each entry against the **installed SDK and Hutch toolchain**, not only
release notes or an upstream issue's status. The upgrade's verification summary names the adaptations
removed, retained with evidence, or changed, and the affected tests run. A new workaround adds an entry
here and rationale in its owning spec; its removal deletes both the workaround and its entry. A
regression test that guards an adaptation stays when the adaptation goes if it still states the
product contract (it then guards upstream's behavior instead).

## Window and shell

- **Windows `hiddenInset` frame controls.** Owner [[module-desktop]], `windowsFrame.ts`. **Removal
  gate:** [electrobun#558](https://github.com/blackboardsh/electrobun/issues/558) ships the system-menu,
  minimize and maximize style bits. Verify `windowsFrame.test.ts` and the Windows desktop smoke.
- **macOS title-bar double-click.** Owner [[module-desktop]], `titleBarDoubleClick.ts` plus preload
  listener and handler. **Removal gate:** the framework handles drag-region double-clicks
  ([electrobun#561](https://github.com/blackboardsh/electrobun/issues/561)); remove all three parts or
  the window toggles twice. Until then, re-check the mirrored app-region property name. Verify `titleBarDoubleClick.test.ts` and the macOS title-bar probe.
- **Explicit navigation rules.** Owner [[module-desktop]], `externalNavigation.ts`. **Removal gate:**
  the documented `navigationRules` constructor option reaches native code. Verify
  `externalNavigation.test.ts` and the artifact navigation smoke.
- **Preload new-window routing.** Owner [[module-desktop]], `externalNavigation.ts`, `preload.ts`.
  **Removal gate:** every renderer reports and cancels `_blank` / `window.open` new-window requests
  (WebKitGTK `NEW_WINDOW_ACTION`; WebView2,
  [electrobun#569](https://github.com/blackboardsh/electrobun/issues/569)). Verify the artifact smoke's
  link, `_blank` and `window.open` probes.
- **History API route reporting.** Owner [[module-desktop]], `preload.ts`. **Removal gate:** native
  navigation events observe `pushState` / `replaceState` and hash navigation. Verify route persistence.
- **Preload passed as source text.** Owner [[module-desktop]], `index.ts`. **Removal gate:** a
  `views://` preload URL loads as a script on Linux (Electrobun 1.18.1 injected it as code). Verify the
  Linux packaged preload smoke.
- **Edge-triggered menu commands and Command-Q key state.** Owner [[module-desktop]], `repeatGate.ts`,
  `quitShortcut.ts`, `keyState.ts`. **Removal gate:** menu actions carry a key-repeat flag and their
  trigger (key or pointer). Verify `repeatGate.test.ts`, `quitShortcut.test.ts`, `keyState.test.ts`.

## Windows identity

- **Executable icon groups and VERSIONINFO.** Owner [[module-desktop]], `postBuild.ts`,
  `windowsExecutableIdentity.ts`. **Removal gate:** Hutch writes the executable identity and replaces
  the main process's icon groups. Verify `windowsExecutableIdentity.test.ts` and artifact resource checks.
- **Window icon.** Owner [[module-desktop]], `windowsWindowIcon.ts`. **Removal gate:** Electrobun sets
  a window icon on Windows. Verify `windowsWindowIcon.test.ts` and the Windows real-window test.
- **Taskbar AppUserModelID.** Owner [[module-desktop]], `windowsTaskbarIdentity.ts`. **Removal gate:**
  Electrobun gives its process and shortcuts a shared AppUserModelID
  ([electrobun#514](https://github.com/blackboardsh/electrobun/issues/514)). Verify
  `windowsTaskbarIdentity.test.ts` and the Windows real-shortcut test.

## Lifecycle and updates

- **Async shutdown behind the synchronous `before-quit`.** Owner [[module-desktop]],
  `updates/quitCoordinator.ts`. **Removal gate:** `before-quit` awaits an asynchronous handler. Verify
  `quitCoordinator.test.ts` and the startup/quit smoke.
- **Resumed `applyUpdate()` after the quit veto.** Owner [[submodule-desktop-updates]],
  `quitCoordinator.ts`. **Removal gate:** the first `applyUpdate()` arms its replacement helper despite
  the `before-quit` veto. Verify `quitCoordinator.test.ts`, `installJourney.test.ts` and updater
  qualification.
- **Leaving the bundle directory at startup.** Owner [[module-desktop]], `index.ts`. **Removal gates:**
  the read-before-`chdir` ordering goes once Electrobun resolves resources from the executable path;
  the `chdir` goes once its launcher starts the main process outside the replaceable bundle. Verify a
  Windows update with long-lived children.

## Build and typing

- **Desktop `noImplicitReturns` off.** Owner [[module-desktop]], `apps/desktop/tsconfig.json`.
  **Removal gate:** an Electrobun release ships
  [electrobun#590](https://github.com/blackboardsh/electrobun/pull/590). Verify desktop typecheck.
- **Desktop `exactOptionalPropertyTypes` off.** Owner [[module-desktop]], `apps/desktop/tsconfig.json`.
  **Removal gate:** the imported SDK `.ts` sources type-check under it
  ([electrobun#516](https://github.com/blackboardsh/electrobun/issues/516)). Verify desktop typecheck.
- **Untyped `build.bun` block.** Owner [[module-desktop]], `electrobun.config.ts`. **Removal gate:**
  `ElectrobunConfig` types `build.bun`. Verify `buildConfig.test.ts`.
- **Child Bun processes in `preBuild`.** Owner [[module-desktop]], `preBuild.ts`. **Gate met** (Hutch
  0.28.2 runs hooks under Bun, not Cottontail); removal is pending, not required. Verify the desktop
  build and artifact smoke.

## CI and release

- **Linux first-install tarball repack.** Owner [[module-ci-release]], `build-binary` `resolve-desktop`.
  Hutch's `createLinuxInstaller` runs `tar -czf … -C staging .`, so the archive has a runner-owned `./`
  entry. **Removal gate:** Hutch archives the installer's members by name, owned `0:0`; verify with
  `tar --numeric-owner -tvzf` on the raw `apps/desktop/artifacts` tarball, then delete the repack. The
  `releaseArtifacts.test.ts` no-`./`/root-owner assertion stays as the contract.
- **System32-first `PATH` on Windows packaging.** Owner [[module-ci-release]], `build-binary`.
  **Removal gate:** Hutch invokes Windows bsdtar by absolute path. Verify `releaseArtifacts.test.ts`
  ("System32 tar ahead of Git tar") and Windows packaging.
- **Retried toolchain download.** Owner [[module-ci-release]], `.github/scripts/prepare-electrobun.sh`.
  **Removal gate:** `electrobun prepare` retries dropped release downloads itself. Verify
  `releaseArtifacts.test.ts` (retry assertion).
- **macOS signing from the expanded `.app.tar.zst`.** Owner [[module-ci-release]], `build-binary`.
  **Removal gate:** Hutch writes final version metadata before `postBuild` and exposes the uncompressed
  app before `postWrap`. Verify the private signing qualification.

## Removed

- **Windows preload socket-port stripping** (Electrobun 2.0.1 bound a shared fixed port). Gone in 2.0.5,
  which binds `SO_EXCLUSIVEADDRUSE` and injects the bound port ([[module-desktop]]).

## Not temporary workarounds

No custom SDK resolver, metadata validator or command runner; the web-owned title bar; Linux without an
application menu; and unsupported DevTools focus and notification-click callbacks are deliberate
choices or accepted gaps in [[module-desktop]]. An Electrobun upgrade does not remove them silently.
