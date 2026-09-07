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
  a bounded generic client-preference adapter under stable backend-profile/window identity; desktop package
  smoke; and the desktop artifact adapter used by shared host probes.
- **Public surface:** the packaged desktop application and its installers — the Windows setup stub
  signed, the macOS `.dmg` and the Linux tarballs not (see *Signing*, below); the build/test-only
  `@thinkrail/desktop/artifact` launcher and installer locators consumed by smoke and E2E harnesses.
- **Allowed deps:** `server` for the embedded host, build-support manifest, and artifact probes; `shared`
  for release identity and the retrying teardown both smokes clean up with; `contracts` for
  compatibility/native-bridge types; the completed built web
  artifact; Electrobun `2.0.1` and its generated SDK; Bun/Node.
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

## Build and release

The package pins the Electrobun `2.0.1` npm bootstrap as a build-only dependency. That exact pin selects
its paired Hutch toolchain and SDK; direct global Hutch invocation and floating version overrides are not
part of the build path. The application explicitly selects the real Bun main process, not the default
Cottontail runtime. Electrobun owns the packaged Bun `1.4.0` version; per-project runtime overrides are
unsupported. The repository's independently pinned development/CI runtime is aligned with it through
[[architecture]]'s root toolchain contract.

Desktop builds run sequentially within one worktree because they share the staging directory and SDK
projection. The explicit build wrapper requires a completed `apps/web/dist`, prepares the pinned SDK,
consumes the server-owned runtime manifest, stages target PTY/trash/skill/web resources under an ignored package-local
directory, emits the transient static factory entry, bundles the self-contained server runtime to a
packaged `.ts` filename, runs Electrobun, and removes generated source even on failure. The wrapper injects
the shared baked version while Electrobun evaluates its isolated config process. App-local Hutch
configuration retains Bun as package manager: the workspace catalog and `bun.lock` remain authoritative;
no Hutch dependency resolver or second lockfile is introduced.

Hutch owns the generated `.hutch/devkit` SDK projection and its shared download cache. The projection is
ignored, never edited or committed, and excluded from repository source-boundary scans. Electrobun's own
bundler resolves its SDK; the independent Bun preload build derives exact aliases from the projected
export map and rejects targets outside its `api/` tree. Falling through to the npm package is forbidden:
the v2 npm package contains only the CLI bootstrap and deliberately throws for SDK imports. Builds and
desktop typechecks run the same pinned `electrobun prepare` path and verify the projected release before
consuming it. Hutch owns cache reuse; a fresh machine needs network access, and preparation failure or a
wrong SDK version fails the check rather than falling back to substitute types. Ordinary install, web
development/builds, and unit tests do not prepare the native SDK.

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
`libwebkit2gtk-4.1-0`, `libayatana-appindicator3-1`, and `librsvg2-2`. Xvfb software-rendering flags are
CI-only and are never shipped as user configuration.

## Verification

- Expanded-app smoke uses isolated HOME/data/PI/cache paths and ready/control files. It requires the
  real webview to reach DOM-ready, confirms native application-menu registration on supported targets,
  and requires the real client's canonicalization of a seeded missing-project route to return through
  the preload/RPC bridge into its route document. This proves native messaging rather than only a ready
  event. Its opt-in navigation probe then requests a blocked external navigation from the real webview
  through the control file's `navigate` command. Only when the probe result path is supplied, the normal
  external-open callback records the URL there instead of launching a user's browser. Smoke requires
  that native event to traverse the production scoped listener and URL parser. Ordinary control-file
  shutdown is unchanged. It runs the shared artifact probes with repository reads denied on macOS,
  quits normally, and observes clean process exit.
- Stable v2 installer filenames omit the leading `stable-` prefix; updater metadata and payloads retain
  it. App identity and stable/canary channels remain unchanged, including existing channel-scoped routes
  and preferences. Artifact collection must distinguish installer outputs from updater payloads.
- First-install smoke executes the produced DMG app, Windows setup ZIP, or Linux setup tarball against
  isolated installation roots, checks the automatically launched host's health, and requires graceful
  exit of the installer, host, and installed launcher. V2 installers launch the installed app themselves;
  the harness supplies its complete isolated host environment before installer invocation and never starts
  a duplicate host. Only the harness sets `ELECTROBUN_INSTALLER_UI_AUTOCLOSE=1` to dismiss the installer's
  terminal progress dialog. The ready seam reports the v2 launcher's `ELECTROBUN_LAUNCHER_PID` separately
  from the Bun host pid. Windows installer smoke runs only on disposable GitHub-hosted Actions runners:
  v2 uses Windows known folders and writes HKCU uninstall registration, which environment-only HOME/
  APPDATA overrides cannot isolate. The harness refuses Windows execution elsewhere before creating
  temporary files or starting an installer; it never snapshots or mutates a developer's real integration.
  The release matrix must pass both smoke layers before uploading the installer.
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
