---
id: module-desktop
type: module-design
status: active
title: Desktop launcher/client (Electrobun)
parent: architecture
depends-on: [module-server, module-contracts, module-shared]
tags: [desktop, v1, launcher, packaging]
references: [submodule-web-navigation, module-artifact-tests]
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
  a bounded generic client-preference adapter under stable backend-profile/window identity; and the
  opt-in live-window test seam. Standalone artifact harnesses belong to [[module-artifact-tests]].
- **Public surface:** the packaged desktop application and its installers. No test-helper library is
  exported by the application package.
- **Allowed deps:** `server` for the embedded host and build-support manifest; `shared`
  for release identity; `contracts` for
  compatibility/native-bridge types; the completed built web
  artifact; Electrobun `2.0.1` and its generated SDK; build-only `pe-library`/`resedit` for the
  Electrobun 2.0.1 Windows-uninstaller icon gap; Bun/Node.
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

Desktop, CLI, and source hosts do not exclude one another by data directory. Every launcher binds an
independent serving port and initializes its own in-process services. If multiple hosts use the same mutable
state, their persistence and event streams are not coordinated and concurrent changes may overwrite one
another.

## Startup and packaged runtime

1. Resolve app resources and set `BUN_PTY_LIB` to the staged current-target FFI library before any server
   import. Electrobun emits an ordinary JavaScript entry, not a `bun build --compile` executable, so it
   does not embed `bun-pty`'s library.
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
   preference map is serialized as data and prepended to the preload source so the web client can hydrate
   before React mounts despite the changing port. Open one normal native `BrowserWindow` with the system
   renderer.

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
Edit role menu. Linux skips registration because Electrobun 2.0.1 does not support application menus
there; WebKitGTK keeps its renderer-native editing behavior. The policy is platform-pure and the packaged
ready seam reports whether registration ran, so unit tests pin menu composition while expanded-app smoke
pins production wiring.

## Navigation and window security

The native window permits navigation only within its exact loopback origin. User-requested external URLs
open through the OS instead of replacing the app surface. Navigation listeners use the SDK emitter's
webview-scoped `will-navigate-<id>` and `new-window-open-<id>` channels; the unscoped payload has no
webview id, and the instance listener's typed event list omits popups. Payload types are derived from
SDK event factories, not copied into local declarations. Detail can be a raw URL, a popup object, or
serialized navigation JSON; bounded decoding retains only a string URL and the HTTP/HTTPS/mailto
allowlist. Native `navigationRules` enforce confinement: navigation-event responses cannot cancel it.

A desktop preload sends typed, one-way route and local-preference messages. It wraps
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
`BrowserWindow.preload`. A `views://` preload URL is forbidden: Electrobun 1.18.1 resolves it on macOS but
injects the literal URL as code on Linux.

## Lifecycle

Every quit path calls the shared idempotent asynchronous server shutdown once. It settles/aborts active
agent work within its bound, drains analytics, disposes server resources and PTYs, and closes sockets.
Electrobun's synchronous `before-quit` callback cancels quit while that promise is pending and retries
`Utils.quit()` under a completion guard. Abrupt death relies only on operating-system process cleanup.

Artifact tests drive this same entrypoint through opt-in environment/ready/control seams: isolated user
data, a hidden neutral window for browser-backed tests, host/launcher ids and origin on DOM-ready, and
normal quit. Native UI smoke can capture an external-open result and request one fixed navigation probe
instead of launching the user's browser. These hooks need the live window; their standalone drivers and
assertions live in the test package, which product code never imports.

## Build and release

The package pins the Electrobun `2.0.1` npm bootstrap as a build-only dependency. That exact pin selects
its paired Hutch toolchain and SDK; direct global Hutch invocation and floating version overrides are not
part of the build path. The application explicitly selects the real Bun main process, not the default
Cottontail runtime. Electrobun owns the packaged Bun `1.4.0` version; per-project runtime overrides are
unsupported. The repository's independently pinned development/CI runtime is aligned with it through
[[architecture]]'s root toolchain contract.

The package runs the official `electrobun build` / `dev` commands. Configuration reads the same shared
version module as the launcher, without an environment-version bridge. One documented `preBuild` hook
builds the shared web artifact and stages the application-specific PTY/trash/skill resources and PI
runtime. The hook runs under Hutch's Cottontail, so it invokes the real Bun CLI to bundle the separately
staged `.ts` server runtime rather than changing PI's bundler. Its transient factory entry is removed
even on failure. Staged resources include the workflow SPEC consumed by the bundled skills. A documented
`postBuild` hook removes staging after the framework has copied it; a failed build's staging is replaced
at the next pre-build. On Windows that hook also brands the bundled uninstaller after its resource exists
but before release compression, wrapping, and signing. Builds in one worktree remain sequential.

Electrobun's platform icon configuration points at one ThinkRail mark in the native formats each target
requires: the macOS iconset, Windows multi-resolution ICO, and Linux PNG. The same Windows ICO is the
Hutch-owned source for the installed app, setup/extractor executable, shortcuts, and taskbar identity; no
release action substitutes a second installer icon. Electrobun 2.0.1 does not apply that icon to its
bundled Windows uninstaller, so the project `postBuild` hook adds the same icon group to
`Resources/uninstall`.

Electrobun's `build.views` owns the browser preload bundle; `build.copy` owns physical resource inclusion.
There is no custom SDK resolver, SDK metadata validator, or Electrobun command runner. App-local Hutch
configuration selects Bun as package manager, retaining the workspace catalog and `bun.lock`.

Hutch owns the generated `.hutch/devkit` projection and download cache. The projection and transient
`.cottontail-tmp` loaders are ignored and excluded from repository source-boundary scans, never edited
or committed. Framework builds prepare it
implicitly; typecheck runs the standard `electrobun prepare` command before TypeScript. Preparation errors
propagate normally, and a fresh machine needs network access. Ordinary install, web-only development/
builds, and unit tests do not prepare the native SDK.

Desktop typechecking consumes the official SDK's `.ts` sources through the same baseUrl-free paths used
by editor tooling; no handwritten API declarations or shadow typecheck config exist. As explicitly
approved, desktop alone sets `exactOptionalPropertyTypes: false` to match Electrobun's source contract,
while retaining `strict: true` and `noUncheckedIndexedAccess: true`. This setting applies to the desktop
compilation, including imported workspace source; every other package retains its separate unchanged
strict check. The upstream source incompatibility is tracked in Electrobun issue #516; `skipLibCheck`
cannot exclude imported implementation `.ts`. The direct-source approach follows the v2 migration guide
and avoids a second declaration-generation pipeline. Canonical main imports use `electrobun/main`; the
preload retains `electrobun/view`, and the RPC schema retains its `bun`/`webview` keys.

References: [official v2 migration](https://framework.blackboard.sh/electrobun/guides/migrating-to-v2/),
[upstream optional-property issue](https://github.com/blackboardsh/electrobun/issues/516).

Desktop installers ship beside the CLI artifacts for macOS ARM64, Windows x64, Linux x64, and
Linux ARM64. Electrobun 2.0.1 publishes no macOS x64 core. Nightly maps to Electrobun canary and stable
maps to stable. Standard formats are DMG on macOS, a setup-EXE-plus-payload ZIP on Windows, and a setup
tar.gz on Linux. The private release pipeline retains the existing `thinkrail-desktop-*` download aliases;
its collector selects the exact framework artifact for the channel and native target. The macOS app
archive is transferred privately for SRE finalization, never published as an updater payload. Updater UX
and publication of updater metadata/patches remain deferred.

### Signing

Signing and notarization use JetBrains-provided services through the private release coordinator;
public builds contain neither service credentials nor a new Apple-login/keychain flow. Current Windows
coverage signs the setup stub without rewriting its hash-keyed adjacent payload.

The native macOS build also exposes Electrobun's standard expanded `.app.tar.zst` as a private signing
input. The approved JetBrains SRE flow signs the expanded app and finalizes a conventional DMG around it,
then signs/notarizes/staples that container. It does not mutate Electrobun's compressed self-extractor
payload or use an incorrect pre-metadata sealing hook. Local framework DMGs remain unsigned build outputs;
only the private pipeline's verified final DMG is a signed release. The handoff and verification contract
belong to [[module-ci-release]].

Linux uses native WebKitGTK without CEF and declares Ubuntu 24.04+/glibc 2.38 plus `libgtk-3-0`,
`libwebkit2gtk-4.1-0`, `libayatana-appindicator3-1`, and `librsvg2-2`. Xvfb software-rendering flags are
CI-only and are never shipped as user configuration.

## Verification

[[module-artifact-tests]] owns expanded-app/first-install smoke, shared host probes, native navigation/
preload verification, and installer isolation. Every native release target must pass both smoke layers;
[[module-browser-e2e]] additionally covers wire-backed behavior against the packaged host. No platform's
native result is inferred from another platform's run. Signed download acceptance requires the private
release checks described in [[module-ci-release]].

## Deferred

Shared/remote backend profiles, profile selection, multi-window/deep-link routing, CEF, and Electrobun
updater UX.
