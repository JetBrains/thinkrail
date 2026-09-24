---
id: module-desktop
type: module-design
status: active
title: Desktop launcher/client (Electrobun)
parent: architecture
depends-on: [module-server, module-contracts, module-shared]
tags: [desktop, v1, launcher, packaging]
references: [submodule-web-navigation, module-artifact-tests, module-ci-release, submodule-web-shell]
---

## Responsibility

The native Electrobun launcher/client over the existing web UI and wire. The V1 local-host profile embeds
the server in the Electrobun Bun process, serves the packaged web artifact on one loopback origin, and
opens that origin in a native system webview. `apps/cli` remains the sibling browser launcher and release
rollback. A later shared-client profile may dial an existing host without introducing another UI, wire, or
engine architecture.

## Boundary

- **Owns:** Electrobun configuration and lifecycle; native window policy, including the per-platform
  title-bar treatment and the window-chrome geometry it publishes to the web client; local `bootHost()` startup;
  packaged resource staging; the PI-compatible server-runtime bundle; desktop route preload/persistence;
  a bounded generic client-preference adapter under stable backend-profile/window identity; and the
  opt-in live-window test seam. Standalone artifact harnesses belong to [[module-artifact-tests]].
- **Public surface:** the packaged desktop application and its installers. No test-helper library is
  exported by the application package.
- **Allowed deps:** `server` for the embedded host and build-support manifest; `shared`
  for release identity; `contracts` for
  compatibility/native-bridge types; the completed built web
  artifact; Electrobun `2.0.1` and its generated SDK; build-only `pe-library`/`resedit` for the
  Electrobun 2.0.1 Windows-uninstaller icon gap; build-only `@resvg/resvg-js` to rasterize the icon
  source (below); Bun/Node.
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
2. Dynamically import the separately built, unpacked `server-runtime.ts` resource. That bundle is built with
   pi's `PI_BUNDLED_NODE=true` define, which makes PI use its embedded-modules extension loader (static jiti
   with Babel bundled, plus virtual modules) for external extensions such as Central. Without the define a
   single-file bundle is treated as a plain Node runtime and PI's lazy Babel `require` cannot resolve inside
   it ([[submodule-server-agent]] owns the seam). Flattening PI into Electrobun's normal entry is still
   forbidden: it would load `bun-pty` before `BUN_PTY_LIB` is set.
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
it can load `bun-pty` before `BUN_PTY_LIB` and bypass the defined server-runtime build. Startup
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

## Native window chrome

The web topbar ([[submodule-web-shell]]) is the window's title bar wherever the framework lets native
controls survive without a native strip. Electrobun 2.0.1 exposes no caption-colour API on any platform
(macOS and Windows only follow the system light/dark setting), so a theme-coloured title bar means
removing the native strip and letting the web header occupy it. The policy is platform-pure
(`windowChrome.ts`, pinned by unit tests) and spread into the main `BrowserWindow`:

| platform | `titleBarStyle` | traffic lights | published left inset |
|---|---|---|---|
| macOS | `hiddenInset` — transparent strip, hidden title, full-size content view; native traffic lights stay | `trafficLightOffset { x: 0, y: 4 }` centres the 12px buttons in the 40px topbar (measured on a packaged build: the default position centres them at 16px, so +4 lands on 20) | `64px` — the traffic-light zone (7 + 3×12 + 2×8 = 59px on the spacing grid) |
| Windows, Linux | `default` | — | `0px` |

Windows is deferred because `hiddenInset` there strips the caption *including* minimize/maximize/close,
which would have to be HTML controls over RPC (and Electrobun has no `HTMAXBUTTON` hit-test, so Win11
snap layouts would not appear). Linux is not planned: `hiddenInset` is a no-op under GTK and `hidden`
removes decorations together with WM-provided resize handles. Fully custom macOS chrome
(`titleBarStyle: "hidden"` with drawn traffic lights) was rejected because the platform provides real
ones.

**Geometry contract.** The desktop publishes three CSS custom properties on `<html>`: the two inset
properties plus `--window-chrome-drag-region` (`drag` | `no-drag`), which tells the page whether its
header is the title bar. The drag flag rides only the initial preload global (it is a per-policy constant);
geometry updates arrive as `windowChromeChanged { insetLeft, insetRight }`. The web consumes the properties
with `0px` fallbacks, so a browser-hosted client and the neutral E2E-host window (`about:blank`, no
preload) are unaffected and the *web client still has no desktop branch*. The preload validates geometry,
keeps only the latest value while the document root is absent, and flushes it at `DOMContentLoaded`, so a
pending startup write cannot overwrite a newer native state. The right inset is always `0px` today and
exists so the Windows follow-up changes a value, not the contract.

**Fullscreen.** macOS native fullscreen auto-hides the traffic lights with the menu bar, so fullscreen
zeroes both insets. The main process publishes geometry on every webview `dom-ready` (a reload during
fullscreen must not inherit the windowed insets) and on `resize` only when the geometry changed. The
neutral E2E-host window (`THINKRAIL_DESKTOP_E2E_HOST=1`) keeps the default native chrome and publishes
nothing.

**Dragging.** The desktop's only contribution is the `drag` flag: the web header's `window-drag` utility
resolves to `-webkit-app-region: drag` only when `--window-chrome-drag-region` says so, and Electrobun's
own injected preload rewrites app-region declarations from same-origin stylesheets into a mirrored custom
property it hit-tests against on `mousedown`. A decorated window (Windows, Linux, the neutral window)
publishes `no-drag` and so never acquires a second, partial drag strip. Double-click-to-zoom on the header
is not promised — the webview covers the strip, so the click reaches `NSWindow` only incidentally.

## Navigation and window security

The native window permits navigation only within its exact loopback origin. User-requested external URLs
open through the OS instead of replacing the app surface. Navigation listeners use the SDK emitter's
webview-scoped `will-navigate-<id>` and `new-window-open-<id>` channels; the unscoped payload has no
webview id, and the instance listener's typed event list omits popups. Payload types are derived from
SDK event factories, not copied into local declarations. Detail can be a raw URL, a popup object, or
serialized navigation JSON; bounded decoding retains only a string URL and the HTTP/HTTPS/mailto
allowlist. Native `navigationRules` enforce confinement: navigation-event responses cannot cancel it.

A desktop preload sends typed, one-way route and local-preference messages, and is the only writer of
the window-chrome CSS properties described above. It wraps
`history.replaceState` and `history.pushState` before page scripts and also reports initial/hash/pop
navigation, because Electrobun's native navigation events do not observe History API route changes. The
main process accepts messages only from the main window. Routes persist as bounded fragment strings in a
versioned channel-scoped document; unreadable/invalid state falls back to `#/v1`. Preferences persist in a
separate bounded, versioned generic string map scoped by `{ backendProfileId, windowId }`; each value is capped
at 256 Ki characters and the complete document remains capped at 1 MiB. The native side validates only
size/shape and never learns feature meaning. Its frozen preload adapter exposes `getItem`,
`setItem`, and `removeItem` only, with writes returning over the typed one-way channel. Malformed messages
are ignored; a filesystem refusal is logged without changing the in-memory document or terminating the
client. The web feature still owns each value's validation and default. The web router remains the route
grammar validator, and the preload exposes no host/domain capability.

The host reads the staged preload bundle and passes its JavaScript **source text** to
`BrowserWindow.preload`. A `views://` preload URL is forbidden: Electrobun 1.18.1 resolves it on macOS but
injects the literal URL as code on Linux.

## Lifecycle

Every quit path calls the shared idempotent asynchronous server shutdown once, including a startup
failure after acquiring the host but before the native window or quit listener is ready. Shutdown ownership
begins as soon as the host is acquired. It settles/aborts active agent work within its bound, drains
analytics, disposes server resources and PTYs, and closes sockets.
Electrobun's synchronous `before-quit` callback cancels quit while that promise is pending and retries
`Utils.quit()` under a completion guard. Startup failure also requests quit directly through that coordinator
in the error-dialog finalizer, so even missing quit interception or a failed dialog cannot bypass shutdown.
Abrupt death relies only on operating-system process cleanup.

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
requires: the macOS iconset, Windows multi-resolution ICO, and Linux PNG. The native mark preserves its
rounded-square silhouette with the ThinkRail glyph in the dark-family brand green (`#8dff4f`) on a solid
black tile; translucent glass, highlights, and decorative edging are excluded so small taskbar frames stay
crisp. The browser favicon and in-app shell mark are separate web-owned surfaces. The same Windows ICO is the
Hutch-owned source for the installed app, setup/extractor executable, shortcuts, and taskbar identity; no
release action substitutes a second installer icon. Electrobun 2.0.1 does not apply that icon to its
bundled Windows uninstaller, so the project `postBuild` hook adds the same icon group to
`Resources/uninstall`.

`assets/icon.svg` is the one hand-authored source; every raster below it (the iconset, the ICO, the
Linux PNG) is generated, never hand-edited, by `scripts/generate-icons.ts` (`bun run generate-icons`)
using `@resvg/resvg-js` to rasterize straight from the vector. The Windows ICO carries PNG-compressed
frames at 16/24/32/48/64/128/256 — Microsoft's documented icon-construction minimum (16/24/32/48/256)
plus two extra sizes so in-between DPI scales interpolate from a close neighbor — packed through the
same `resedit` dependency already used for the uninstaller. A prior 4-frame raw-BMP ICO (16/32/48/256,
pre-dating the generator) had no frame matching the Windows 11 taskbar's 24×24 100%-scale target,
reading as blurry there; the generated set closes that gap.

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
archive is transferred privately for SRE finalization, never published as an updater payload. Runtime
updating is integrated below; feed publication remains release-owned and gated by the target policy.

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

## Auto-update policy

Desktop updates check after window readiness and then on a jittered six-hour schedule with bounded retries.
Checks and full-package downloads run in the background without blocking startup. Manual checks acknowledge
promptly and state converges asynchronously through monotonic revisions. The one native controller owns the
SDK's single status callback, coalesces concurrent work, reconciles returned errors as well as thrown ones,
and retains a prepared newer version across transient poll failures. Electrobun's hash inequality alone is
not eligibility: same-version and downgrade manifests are not downloaded or offered.

Production checks are enabled only in packaged supported stable/canary applications whose stamped release
metadata supplies a nonempty HTTPS updater base URL. That packaged metadata is the sole feed authority;
development and standard artifact-test seams stay disabled and cannot select a feed. Installation requires an
explicit **Restart to Update** action; **Later** preserves the
running app, and ordinary quit does not silently install. A cross-platform in-app control exposes manual
checking, progress, the available version and retry; native menus are supplementary because this SDK has no
Linux application menu. Installations stay on their packaged channel; CLI and remote-host updates are outside
this capability. Release scope and manual-first acceptance belong to [[module-ci-release]].

Electrobun calls, updater scheduling and update lifecycle stay behind the bounded desktop `updates` module;
update controls stay in the web client and graceful host shutdown stays in server. The frozen optional
`__THINKRAIL_NATIVE_UPDATES__` preload capability carries `getState`, prompt `checkForUpdates` and
`restartToUpdate` requests, plus state subscription over the typed native RPC. Web imports no desktop SDK,
and an ordinary browser connection acquires no host-update operation. An update restarts the entire local
host: active agents may be aborted and PTYs terminate. **Restart to Update** is the sole confirmation and
uses the existing ordinary-quit shutdown. There is no additional warning dialog, update-specific draft
saving, or renderer-preparation handshake.

Quit coordination preserves its completion action. Electrobun 2.0.1's first `applyUpdate()` returns on the
asynchronous `before-quit` veto before arming its replacement helper. The update intent waits for the same
idempotent host shutdown, waits for that first SDK call to settle, and then resumes `applyUpdate()` under the
completed guard; ordinary completion still calls only `Utils.quit()`. A failed second handoff reports a
native error and exits instead of leaving a serverless window. SDK replacement rollback is not
application-health or user-data rollback. Existing installations without update code/feed identity require
one manual bootstrap installation.

Reference: [pinned updater handoff](https://github.com/blackboardsh/electrobun/blob/v2.0.1/package/src/sdks/main/core/Updater.ts#L2220-L2330).

## Verification

[[module-artifact-tests]] owns expanded-app/first-install smoke, shared host probes, native navigation/
preload verification, and installer isolation. Every native release target must pass both smoke layers;
[[module-browser-e2e]] additionally covers wire-backed behavior against the packaged host. No platform's
native result is inferred from another platform's run. Signed download acceptance requires the private
release checks described in [[module-ci-release]].

## Deferred

Shared/remote backend profiles, profile selection, multi-window/deep-link routing, CEF, and the Windows
frameless title bar (HTML minimize/maximize/close over RPC behind a window-controls capability the geometry
contract does not yet carry). The update feed publication described above remains release-owned.
