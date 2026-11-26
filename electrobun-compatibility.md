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
product contract (it then guards upstream's behavior instead). The step-by-step upgrade procedure
lives in the repo skill `.agents/skills/upgrading-core-dependencies` (`playbooks/electrobun.md`); this registry
stays the list of what it re-checks.

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
- **Linux main window shown after its webview attaches.** Owner [[module-desktop]], `webviewFocus.ts`.
  Electrobun 2.0.5 shows the window (`gtk_widget_show_all` + `gtk_window_present`) before attaching the
  WebKitWebView and has no `gtk_widget_grab_focus`. On a real display (WebKitGTK 2.52.6, i3, 2026-11-20)
  the window opened with `document.hasFocus()=false` and the first ↓ never reached the page, while
  MiniBrowser on the same host got every key. Created hidden and shown after attach, it opened with
  `hasFocus=true` and every key arrived. There is no webview focus API yet
  ([electrobun#142](https://github.com/blackboardsh/electrobun/issues/142), open on 2026-11-20), so focus
  lost mid-session is not restored. **Removal gate:** Electrobun focuses the webview when it attaches it,
  or #142 ships a webview focus call. Verify on a Linux display, without the helper, that a fresh window
  reports `hasFocus=true` and the first key (xdotool ↓) reaches the page; `webviewFocus.test.ts` goes with
  the helper.
- **Linux WebKit DMA-BUF renderer.** Owner [[module-desktop]], `linuxWebKitRenderer.ts`, `entry.ts`.
  On NVIDIA Wayland, WebKitGTK's DMA-BUF renderer fails to create GBM buffers (`Failed to create GBM
  buffer … Invalid argument`, `X11 Error: GLXBadWindow`) as Electrobun loads and again when the main
  window is created, so the window stays blank (white, or solid gray). `entry.ts` imports this module
  before `deepLinkBootstrap.ts`, which loads `electrobun/main/events`. On import the module sets
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` when the variable is absent, in `process.env` and through libc
  `setenv` (Bun does not forward `process.env` writes to the native environment). A value the user already exported,
  including `0`, is preserved. `LIBGL_ALWAYS_SOFTWARE` and `WEBKIT_DISABLE_COMPOSITING_MODE` stay
  CI-only Xvfb flags. **Removal gate:** drop it once a packaged Linux desktop on NVIDIA Wayland creates
  its GBM buffers and paints the UI with the variable unset. Verify `linuxWebKitRenderer.test.ts` and
  `buildConfig.test.ts` (entry order).
- **Edge-triggered menu commands and Command-Q key state.** Owner [[module-desktop]], `repeatGate.ts`,
  `quitShortcut.ts`, `keyState.ts`. **Removal gate:** menu actions carry a key-repeat flag and their
  trigger (key or pointer). Verify `repeatGate.test.ts`, `quitShortcut.test.ts`, `keyState.test.ts`.

- **Linux paste and drop of files (WebKitGTK, CVE-2025-13947).** Owners [[module-desktop]]
  (`nativeClipboard.ts`, `clipboardBridge.ts`, preload, `readClipboard` RPC) and [[submodule-web-chat]]
  (`attachmentPasteDropHandlers`). WebKitGTK ≥ 2.50.3 empties pasted and dropped files, so a Linux paste
  without files reads the system clipboard natively, and a drop that arrives emptied only explains itself.
  **Removal gate:** the system WebKitGTK hands pasted files to the page (the paste fix ships in WebKitGTK
  2.54) — then drop the bridge, its RPC and the helpers; a drop fix (not merged upstream yet) retires the
  drop notice. Verify with a file-manager copy and a screenshot paste into the composer on the packaged
  Linux app.
- **Electrobun's Linux clipboard reads block the host and leak.** Owner [[module-desktop]]
  (`nativeClipboard.ts`, *Native clipboard*). In 2.0.5 `Utils.clipboardAvailableFormats/ReadText/ReadImage`
  are synchronous FFI calls that `dispatch_sync_main` onto GTK while the Bun thread, which runs the
  in-process host, waits — up to GTK's ~30 s selection timeout per wait when the clipboard owner hangs;
  `clipboardReadImage` decodes and re-encodes the image inside that wait, returns a `malloc`'d PNG that
  `proc/native.ts` copies and never frees (one leak per image paste), and there is no `text/uri-list` read.
  So the desktop reads through `wl-paste` / `xclip` first (asynchronous, killed at a timeout) and calls
  Electrobun only when no helper runs. **Removal gate:** Electrobun offers an asynchronous (or off-main)
  clipboard read that frees its buffer, a URI-list or arbitrary-target read, and a target listing — then
  read through it and drop the helpers; until then a GTK main-thread wait the host does not block on (no
  `dispatch_sync` from the Bun thread) at least lets the fallback stay. Verify against the installed
  `api/sdks/main/proc/native.ts` (`clipboardReadImage`'s "We should free it" note) and its native wrapper.
- **Static agent mockups inside the desktop window.** Owner [[module-resource-renderers]] (the
  interactive-HTML rule), `apps/web/src/shell/nativeBridges.ts` + `AppResourceHost.tsx`. Electrobun 2.0.5
  registers its WebKit message handlers (`bunBridge`, `internalBridge`) for every frame, and the internal RPC
  dispatcher runs `webviewTagExecuteJavascript` in a view id the caller supplies, so any script in a subframe
  — even an opaque `sandbox="allow-scripts"` one — reaches native code and the trusted page; the web app
  therefore registers no interactive-HTML globs when its page has a native message bridge. **Removal gate:**
  native message handlers answer only the main frame and the internal dispatcher rejects target views its
  caller does not own, on WebKit (macOS, Linux) and WebView2. Verify `nativeBridges.test.ts` and a scripted
  subframe probe against the packaged app.

## Windows identity

- **Executable icon groups and VERSIONINFO.** Owner [[module-desktop]], `postBuild.ts`,
  `windowsExecutableIdentity.ts`. **Removal gate:** Hutch writes the executable identity and replaces
  the main process's icon groups. Verify `windowsExecutableIdentity.test.ts` and artifact resource checks.
- **Window icon.** Owner [[module-desktop]], `windowsWindowIcon.ts`. **Removal gate:** Electrobun sets
  and refreshes a window icon on Windows. Verify `windowsWindowIcon.test.ts` and the Windows real-window test.
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
- **Cold-launch `open-url` listener before the SDK.** Owner [[module-desktop]], `entry.ts`,
  `deepLinkBootstrap.ts`. `open-url` has no replay, and `electrobun/main` installs the native URL handler
  that delivers a cold-launch link while it loads, so `entry.ts` imports the bootstrap's listener before
  `index.ts` loads `electrobun/main`. The DMA-BUF workaround is imported ahead of the bootstrap.
  **Removal gate:** Electrobun replays or buffers `open-url` for a listener added after startup. Verify
  `buildConfig.test.ts` (entry order), `deepLinkBootstrap.test.ts` and a cold launch from a
  `thinkrail://` link.
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
  entry ([hutch#7](https://github.com/blackboardsh/hutch/issues/7)). **Removal gate:** Hutch archives
  the installer's members by name, owned `0:0`; verify with
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
application menu; unsupported DevTools focus and notification-click callbacks; and `thinkrail://` links
only on macOS (`app.urlSchemes` registers nothing on Windows or Linux) are deliberate choices or accepted
gaps in [[module-desktop]]. An Electrobun upgrade does not remove them silently.

These native identity gaps, present in Electrobun 2.0.5 / Hutch 0.28.2, are accepted rather than
worked around; an upgrade that closes one drops it from this list:

- **Linux window icon.** Electrobun resolves its automatic window icon, `Resources/appIcon.png`,
  against the process cwd, which is never the bundle root, so windows carry a generic icon.
- **Linux notification sender.** Electrobun runs `notify-send` without an app name, icon or
  desktop-entry hint, so notifications come from "notify-send" with a generic icon.
- **Linux menu category.** Hutch's `.desktop` template hardcodes `Categories=Utility;`.
- **Windows Installed-apps publisher.** Electrobun's `Uninstall` registry entry has no `Publisher`.
- **Windows setup file properties.** Hutch writes no VERSIONINFO and builds the setup executable in
  its release step, after `postBuild` has branded the other executables.
