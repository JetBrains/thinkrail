---
id: module-desktop
type: module-design
status: active
title: Desktop launcher/client (Electrobun)
parent: architecture
depends-on: [module-server, module-contracts, module-shared]
tags: [desktop, v1, launcher, packaging]
references: [submodule-web-navigation]
---

## Responsibility

The native Electrobun launcher/client over the existing web UI and wire. The V1 local-host profile embeds
the server in the Electrobun Bun process, serves the packaged web artifact on one loopback origin, and
opens that origin in a native system webview. `apps/cli` remains the sibling browser launcher and release
rollback. A later shared-client profile may dial an existing host without introducing another UI, wire, or
engine architecture.

## Boundary

- **Owns:** Electrobun configuration and lifecycle; native window and integrated-chrome policy; local
  `bootHost()` startup; packaged resource staging; the PI-compatible server-runtime bundle; desktop route
  preload/persistence; a bounded generic client-preference adapter under stable backend-profile/window
  identity; the capability-shaped native-window adapter and platform helpers; desktop package smoke; and
  the desktop artifact adapter used by shared host probes.
- **Public surface:** the packaged desktop application and its installers — the Windows setup stub
  signed, the macOS `.dmg` and the Linux tarballs not (see *Signing*, below); the build/test-only
  `@thinkrail/desktop/artifact` launcher and installer locators consumed by smoke and E2E harnesses.
- **Allowed deps:** `server` for the embedded host, build-support manifest, and artifact probes; `shared`
  for release identity and the retrying teardown both smokes clean up with; `contracts` for
  compatibility/native-bridge types; the completed built web
  artifact; Electrobun `2.0.1`; Bun/Node.
- **Forbidden:** spawning the CLI or a second engine process; implementing ordinary product feature or
  agent/domain logic; importing web source at runtime; introducing a desktop-only wire or domain/view-state
  authority; storing one active location on the backend; or bundling CEF without a new acceptance failure
  that justifies it. Native shell, lifecycle, presentation capabilities, and packaging concerns are the
  only desktop-specific behavior.

## V1 profile and topology

V1 ships only the local-host profile. One Electrobun Bun process owns the native shell and server on the
same event loop; the accepted in-process crash trade-off is unchanged. The host binds loopback port `0`
and its actual port forms the window origin. The packaged `web/dist`, `/ws`, `/files`, and SPA fallback
therefore remain same-origin. One built web client still serves every launcher and contains no desktop
feature/domain branch; its composition shell may discover the frozen native-window presentation capability
that the desktop preload injects before React. A dynamic loopback port is never persisted.

Desktop, CLI, and source hosts do not exclude one another by data directory. Every launcher binds an
independent serving port and initializes its own in-process services. If multiple hosts use the same mutable
state, their persistence and event streams are not coordinated and concurrent changes may overwrite one
another.

## Startup and packaged runtime

1. Resolve app resources and set `BUN_PTY_LIB` to the staged current-target FFI library before any server
   import. Electrobun uses ordinary `Bun.build`; unlike `bun build --compile`, it does not embed
   `bun-pty`'s library.
2. Dynamically import the separately built, unpacked `server-runtime.ts` resource. The `.ts` filename is a
   runtime contract: PI then selects its TypeScript source-runtime Jiti path and supplies bundled virtual
   modules to external extensions. Flattening PI into Electrobun's normal `.js` entry makes it select
   built-Node aliases that are absent from a self-contained app and breaks Central/external extensions.
3. The runtime value-imports the five bundled extension factories and calls `registerBundledRuntime()`
   with those factories, the named `pi-web-access` factory needed by delegation children, the staged skills,
   and macOS/Windows trash helpers. The generator's key map must satisfy every key of the server-owned
   `BundledExtensions` contract, so adding a required launcher field fails desktop typecheck instead of
   producing a packaged-only `undefined`. It then calls `bootHost()` on loopback port `0` with the staged web
   directory, baked version, and `desktop` analytics provenance.
4. Restore the valid route fragment and bounded client-preference map for
   `{ backendProfileId: "local", windowId: "main" }`. The route is appended to the fresh origin; the
   preference map and native-window capability are serialized as data and prepended to the preload source
   so the web client can hydrate before React mounts despite the changing port. Open one system-renderer
   `BrowserWindow` under the platform chrome policy below.

The Electrobun entry bundle contains native-shell code only. A static server import there is forbidden:
it can load `bun-pty` before `BUN_PTY_LIB` and flatten PI into the wrong extension-loader mode. Startup
failure is logged through the shared crash path, shown in a native error dialog, and exits without leaving
a hidden host.

Packaged resources remain physical and unpacked: web assets and skills are read through filesystem paths,
the PTY uses FFI, trash helpers are executable sidecars, and the preload is read as source text. ASAR is
not part of this design.

## Integrated native window chrome

The desktop window has one application-chrome row: the existing shell topbar, never a native title row
stacked above it. The visual composition is shared while the mechanism is platform-specific:

- macOS uses `hiddenInset`; AppKit retains the native traffic lights and the shell reserves their measured
  leading safe area.
- Windows uses `hiddenInset`; the shell supplies Windows-style minimize, maximize/restore, and close
  controls over the preserved DWM frame. WebView2 non-client app-region handling owns native move, snap,
  drag-from-maximized, double-click, and system-menu behavior; the launcher restores the standard window
  style capabilities that Electrobun's collapsed caption omits. Because that collapsed caption returns
  client hit-testing along the top edge, the shell's invisible edge targets start the corresponding native
  DWM resize loop rather than synthesizing geometry in JavaScript.
- Linux uses `hidden`; the shell supplies Linux-style controls. Native move and all eight resize directions
  delegate to GTK/the compositor. A package-owned native helper enters the GTK main context and calls the
  standard move/resize primitives; JavaScript never synthesizes a resize loop from pointer deltas.

The preload exposes one frozen, capability-shaped adapter: platform/control policy; close, minimize,
maximize/restore, and resize-start actions; current maximize state; and state subscription. It exposes no
filesystem, host, wire, or arbitrary RPC access. A browser has no adapter, keeps the ordinary header inset,
and renders no window controls. This is native progressive enhancement of one web artifact, not a second
UI or deployment state model.

The topbar is the drag region and every interactive descendant is an explicit no-drag region. Native close
enters the ordinary close/quit lifecycle rather than bypassing server shutdown. App-drawn buttons use the
web design system (Remix icons, semantic token utilities, visible focus, accessible names), reflect
maximize versus restore, and are absent where macOS supplies native controls. The existing connection dot
and responsive label remain unchanged. No third-party titlebar/control renderer is used.

Target-native behavior is a release contract, not visual polish: move, every-edge resize, maximize/restore,
minimize, graceful close, Windows snap and system menu, standard editing shortcuts, and accessible controls
must all remain usable. A platform that cannot pass that contract keeps the issue open; the gate is never
weakened to ship a one-row imitation.

## Native application menu

The shell installs Electrobun's native application menu before creating the main window. Native roles,
not browser-level key handlers, own standard editing commands so Command/Ctrl-C, V, X, A, Z, and Shift-Z
flow through the operating-system responder chain across ordinary inputs, Monaco, xterm, and future
webview surfaces without competing with their local key handling.

macOS receives the conventional application, Edit, and Window role menus. Windows registers the supported
native Edit roles to retain native accelerator dispatch but attaches no second menu row under custom chrome.
Linux skips registration because Electrobun does not support application menus there; WebKitGTK keeps its
renderer-native editing behavior. The policy is platform-pure and the packaged
ready seam reports whether registration ran, so unit tests pin menu composition while expanded-app smoke
pins production wiring and editing behavior.

## Navigation and window security

The native window permits navigation only within its exact loopback origin. User-requested external URLs
open through the OS instead of replacing the app surface.

A desktop preload sends typed route, local-preference, and bounded native-window-control messages. It wraps
`history.replaceState` and `history.pushState` before page scripts and also reports initial/hash/pop
navigation, because Electrobun's native navigation events do not observe History API route changes. The
main process accepts messages only from the main window. Routes persist as bounded fragment strings in a
versioned channel-scoped document; unreadable/invalid state falls back to `#/v1`. Preferences persist in a
separate bounded, versioned generic string map scoped by `{ backendProfileId, windowId }`; the native side
validates only size/shape and never learns feature meaning. Its frozen preload adapter exposes `getItem`,
`setItem`, and `removeItem` only, with writes returning over the typed one-way channel. Malformed messages
are ignored; a filesystem refusal is logged without changing the in-memory document or terminating the
client. The web feature still owns each value's validation and default. The web router remains the route
grammar validator, and the preload exposes no host/domain capability.

The host reads the staged preload bundle and passes its JavaScript **source text** to
`BrowserWindow.preload`. A `views://` preload URL remains forbidden because source-text injection is the
cross-platform contract.

## Lifecycle

Every quit path calls the shared idempotent asynchronous server shutdown once. It settles/aborts active
agent work within its bound, drains analytics, disposes server resources and PTYs, and closes sockets.
Electrobun's synchronous `before-quit` callback cancels quit while that promise is pending and retries
`Utils.quit()` under a completion guard. Abrupt death relies only on operating-system process cleanup.

## Build and release

The package pins Electrobun `2.0.1` and keeps its Bun main process (packaged Bun `1.4.0`); moving to
Cottontail is not part of the titlebar change. Its explicit build wrapper requires a completed
`apps/web/dist`, consumes the server-owned runtime manifest, stages target PTY/trash/skill/web/native-chrome
resources under an ignored package-local directory, emits the transient static factory entry, bundles the
self-contained server runtime to a packaged `.ts` filename, runs Electrobun through its pinned Hutch
front door, and removes generated source even on failure. Ordinary root development and web-build commands
do not download or build Electrobun. The wrapper also injects the shared baked version while Electrobun
evaluates its isolated config process.

Desktop typecheck maps only the consumed Electrobun API surface to a package-local declaration adapter
through a dedicated config; Electrobun/Hutch's generated devkit is a build input, not another repository
source tree for the TypeScript project to absorb. The wrapper syncs that devkit before its external
`Bun.build` and derives exact Electrobun aliases from the devkit export map. Falling through to the v2 npm
bootstrap bundles its deliberate `moved.cjs` throw: injected data executes, then the custom preload dies
before installing either browser adapter. The runtime build therefore always resolves the real projected
SDK. The adapter is a compatibility boundary, not a runtime fork, and stays limited to APIs the launcher
and preload consume.

Desktop installers ship beside the CLI artifacts for macOS ARM64, Windows x64, Linux x64, and
Linux ARM64. Nightly maps to Electrobun canary and stable maps to stable. Updater UX is deferred.

### Signing

Signing happens outside this repository (`JetBrains/thinkrail-signing`), and reaches only the Windows
installer's `ThinkRail-Setup.exe` stub. The payload beside it is keyed by the `hash` field in
`ThinkRail-Setup.metadata.json`, so rewriting it would desync the installer. The macOS `.dmg` is not
signed at all: `ThinkRail.app` seals no resources and its real payload — Bun runtime, `bun-pty` — is a
`.tar.zst` under `Contents/Resources/` that self-extracts on first launch. Notarization requires every
executable to be present and signed at submission, so signing the `.dmg` would be cosmetic while
Gatekeeper still blocked the download. Making macOS desktop signable is a packaging change here, not a
pipeline change.

Smoke teardown of a temp tree that a launcher ran from must go through `@thinkrail/shared/removeTree`.
Windows releases handles asynchronously after a child exits, so a bare recursive remove throws `EBUSY`
and fails the release *after* every assertion has already passed. `rmSync`'s own `maxRetries`/`retryDelay`
do not fix that here — Bun ignores them — so the retry loop has to be ours. The retry is teardown
resilience, not error suppression: a tree that stays locked past the backoff still throws.

Linux uses native WebKitGTK without CEF and declares Ubuntu 24.04+/glibc 2.38 plus `libgtk-3-0`,
`libwebkit2gtk-4.1-0`, `libayatana-appindicator3-1`, and `librsvg2-2`. Xvfb, Openbox, `wmctrl`, `xdotool`,
and software-rendering flags are CI-only smoke infrastructure and are never shipped as user
configuration.

## Verification

- Expanded-app smoke uses isolated HOME/data/PI/cache paths and ready/control files. It requires the
  real custom preload and the shell's actual native-chrome mount to handshake after DOM-ready, confirms the
  titlebar policy and native application
  menu on each target, exercises maximize/minimize/restore state through the live Windows/Linux window,
  closes through the same graceful controller path as the app button, runs the shared artifact probes with
  repository reads denied, and observes clean process exit. Windows' interaction probe additionally
  requires the preserved native style/system menu and drives the titlebar plus all eight web-to-DWM resize
  targets with real input before top-edge snap; Linux drives the titlebar and all eight web-to-GTK resize
  targets with real pointer input under Openbox. The native window manager/compositor, rather than a
  JavaScript substitute, must change each frame. macOS
  retains native AppKit controls; local accessibility geometry and drag probes cover their placement and
  the web drag region.
- First-install smoke executes the produced DMG app, Windows setup ZIP, or Linux setup tarball against
  isolated installation roots, boots the installed host, checks health, and requires graceful exit. The
  release matrix must pass both smoke layers before uploading the installer.
- Electrobun names installer artifacts per channel, and the channel lands in a different position on each
  platform: the Linux setup tarball carries it in the app-file stem (`ThinkRail-canary-Setup.tar.gz`)
  while the Windows setup executable inside the ZIP carries it after `-Setup`
  (`ThinkRail-Setup-canary.exe`; only `stable` is unsuffixed). First-install smoke therefore resolves the
  Windows setup executable from the requested channel and `src/artifact.test.ts` pins that derivation: a
  channel-blind `*Setup.exe` match passes stable and fails every nightly, which is how the first Windows
  nightly after desktop packaging landed failed while every other target published.
- The shared host-agnostic artifact suite runs through a desktop adapter and the CLI adapter. Both must
  load an external synthetic PI extension with no `pi` executable under default and custom agent dirs,
  create a session through all bundled factories, expose bundled and project-portable skills, reach an
  OAuth auth URL, exercise transcript trash, serve health/UI, and shut down. Desktop proof must not read
  repository or project `node_modules` paths.
- Desktop-backed no-agent Playwright launches the packaged process as host while its required native
  window stays hidden on a neutral local page, avoiding two hydrated clients competing for terminals or
  layout. A separate native smoke loads the real UI.
- Every native release runner boot-smokes its own package. Linux x64/ARM64 additionally run in clean
  Ubuntu 24.04 images; native Windows execution is mandatory because it cannot be inferred locally.

## Deferred

Shared/remote backend profiles, profile selection, multi-window/deep-link routing, CEF, a signed and
notarized macOS `.dmg` (see above), and Electrobun updater UX.
