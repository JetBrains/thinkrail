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

- **Owns:** Electrobun configuration and lifecycle; native window policy; local `bootHost()` startup;
  packaged resource staging; the PI-compatible server-runtime bundle; desktop route preload/persistence;
  desktop package smoke; and the desktop artifact adapter used by shared host probes.
- **Public surface:** the packaged desktop application and unsigned installers; the build/test-only
  `@thinkrail/desktop/artifact` launcher locator consumed by smoke and E2E harnesses.
- **Allowed deps:** `server` for the embedded host, build-support manifest, and artifact probes; `shared`
  for release identity; `contracts` for compatibility/native-bridge types; the completed built web
  artifact; Electrobun `1.18.1`; Bun/Node.
- **Forbidden:** spawning the CLI or a second engine process; implementing ordinary product feature or
  agent/domain logic; importing web source at runtime; introducing a desktop-only wire or UI state model;
  storing one active location on the backend; or bundling CEF without a new acceptance failure that
  justifies it. Native shell, lifecycle, and packaging concerns are the only desktop-specific behavior.

## V1 profile and topology

V1 ships only the local-host profile. One Electrobun Bun process owns the native shell and server on the
same event loop; the accepted in-process crash trade-off is unchanged. The host binds loopback port `0`
and its actual port forms the window origin. The packaged `web/dist`, `/ws`, `/files`, and SPA fallback
therefore remain same-origin and the web client has no desktop branch. A dynamic loopback port is never
persisted.

Exactly one host may own a canonical ThinkRail data directory. Desktop and CLI both acquire the shared
kernel-held loopback ownership lease before mutable host initialization. A matching owner fingerprint is
refused with an actionable already-running result; a different owner advances through deterministic
candidates; an occupied candidate that does not answer the bounded versioned handshake fails closed. The
lease is released by graceful shutdown or automatically by process death, with no stale filesystem lock.

## Startup and packaged runtime

1. Resolve app resources and set `BUN_PTY_LIB` to the staged current-target FFI library before any server
   import. Electrobun uses ordinary `Bun.build`; unlike `bun build --compile`, it does not embed
   `bun-pty`'s library.
2. Dynamically import the separately built, unpacked `server-runtime.ts` resource. The `.ts` filename is a
   runtime contract: PI then selects its TypeScript source-runtime Jiti path and supplies bundled virtual
   modules to external extensions. Flattening PI into Electrobun's normal `.js` entry makes it select
   built-Node aliases that are absent from a self-contained app and breaks Central/external extensions.
3. The runtime value-imports the five bundled extension factories and calls `registerBundledRuntime()`
   with the staged skills and macOS/Windows trash helpers, then calls `bootHost()` on loopback port `0`
   with the staged web directory, baked version, and `desktop` analytics provenance. `bootHost()` acquires
   ownership before its mutable initialization.
4. Restore the valid route fragment for `{ backendProfileId: "local", windowId: "main" }`, append it to
   the fresh origin, and open one normal native `BrowserWindow` with the system renderer.

The Electrobun entry bundle contains native-shell code only. A static server import there is forbidden:
it can load `bun-pty` before `BUN_PTY_LIB` and flatten PI into the wrong extension-loader mode. Startup
failure is logged through the shared crash path, shown in a native error dialog, and exits without leaving
a hidden host.

Packaged resources remain physical and unpacked: web assets and skills are read through filesystem paths,
the PTY uses FFI, trash helpers are executable sidecars, and the preload is read as source text. ASAR is
not part of this design.

## Native application menu

The shell installs Electrobun's native application menu before creating the main window. Native roles,
not browser-level key handlers, own standard editing commands so Command/Ctrl-C, V, X, A, Z, and Shift-Z
flow through the operating-system responder chain across ordinary inputs, Monaco, xterm, and future
webview surfaces without competing with their local key handling.

macOS receives the conventional application, Edit, and Window role menus. Windows receives the supported
Edit role menu. Linux skips registration because Electrobun 1.18.1 does not support application menus
there; WebKitGTK keeps its renderer-native editing behavior. The policy is platform-pure and the packaged
ready seam reports whether registration ran, so unit tests pin menu composition while expanded-app smoke
pins production wiring.

## Navigation and window security

The native window permits navigation only within its exact loopback origin. User-requested external URLs
open through the OS instead of replacing the app surface.

A desktop preload sends one typed, one-way `route.changed { hash }` message. It wraps
`history.replaceState` and `history.pushState` before page scripts and also reports initial/hash/pop
navigation, because Electrobun's native navigation events do not observe History API route changes. The
main process accepts messages only from the main window and persists only a bounded fragment string in a
versioned channel-scoped route document; unreadable/invalid state falls back to `#/v1`. The web router
remains the route grammar validator. The preload exposes no host/domain capability.

The host reads the staged preload bundle and passes its JavaScript **source text** to
`BrowserWindow.preload`. A `views://` preload URL is forbidden: Electrobun 1.18.1 resolves it on macOS but
injects the literal URL as code on Linux.

## Lifecycle

Every quit path calls the shared idempotent asynchronous server shutdown once. It settles/aborts active
agent work within its bound, drains analytics, disposes server resources and PTYs, closes sockets, and
then releases ownership. Electrobun's synchronous `before-quit` callback cancels quit while that promise is
pending and retries `Utils.quit()` under a completion guard. Abrupt death relies only on kernel cleanup.

## Build and release

The package pins Electrobun `1.18.1` and packaged Bun `1.3.14`. Its explicit build wrapper requires a
completed `apps/web/dist`, consumes the server-owned runtime manifest, stages target PTY/trash/skill/web
resources under an ignored package-local directory, emits the transient static factory entry, bundles the
self-contained server runtime to a packaged `.ts` filename, runs Electrobun, and removes generated source
even on failure. Ordinary root development and web-build commands do not download or build Electrobun.
The wrapper also injects the shared baked version while Electrobun evaluates its isolated config process.

Electrobun `1.18.1` publishes implementation `.ts` files that do not typecheck under the repository's
strict TypeScript 6 settings. Desktop typecheck therefore maps only the consumed Electrobun API surface
to a package-local declaration adapter through a dedicated typecheck config. The runtime build config has
no such mapping and always resolves the real package. The adapter is a compatibility boundary, not a
runtime fork, and must stay limited to APIs the launcher and preload actually consume.

Unsigned desktop installers ship beside the CLI artifacts for macOS ARM64, Windows x64, Linux x64, and
Linux ARM64. Nightly maps to Electrobun canary and stable maps to stable. Signing, notarization, and updater
UX are deferred.

Linux uses native WebKitGTK without CEF and declares Ubuntu 24.04+/glibc 2.38 plus `libgtk-3-0`,
`libwebkit2gtk-4.1-0`, `libayatana-appindicator3-1`, and `librsvg2-2`. Xvfb software-rendering flags are
CI-only and are never shipped as user configuration.

## Verification

- Expanded-app smoke uses isolated HOME/data/PI/cache paths and ready/control files. It requires the
  real webview to reach DOM-ready, confirms native application-menu registration on supported targets,
  runs the shared artifact probes with repository reads denied, quits through normal lifecycle, and
  observes clean process exit.
- First-install smoke executes the produced DMG app, Windows setup ZIP, or Linux setup tarball against
  isolated installation roots, boots the installed host, checks health, and requires graceful exit. The
  release matrix must pass both smoke layers before uploading the installer.
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

Shared/remote backend profiles, profile selection, multi-window/deep-link routing, CEF, signed/notarized
artifacts, and Electrobun updater UX.
