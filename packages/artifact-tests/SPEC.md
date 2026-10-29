---
id: module-artifact-tests
type: module-design
status: active
title: Native artifact test harnesses
parent: architecture
depends-on: [module-cli, module-server, module-shared]
references: [module-desktop, module-browser-e2e, module-ci-release, module-ext-visualize, module-ext-ask-user-question]
tags: [testing, artifacts, public-surface-checked]
---

## Responsibility

Source-only test infrastructure for the compiled CLI and native desktop artifacts: real process
adapters, shared HTTP/WS/resource/extension probes, expanded desktop smoke, and first-install smoke.
It consumes finished artifacts; it does not build the application or supply application runtime code.

## Boundary

- **Owns:** artifact locators, isolated environments, native/installer smoke entrypoints, shared host
  probes, their fixtures and helper unit tests, and the public build action's desktop packaging-invocation
  and artifact-collector contract tests.
- **Public surface:** `locateDesktopLauncher`
- **Allowed deps:** CLI's public artifact-name helper; server's sanctioned history-fixture export; shared
  release identity, its Windows file identity and icon, and retrying teardown; `resedit` to read Windows
  executable resources;
  read-only access to
  `.github/actions/build-binary/action.yml` for executing its packaging invocation and collector in
  isolated fixture directories; Bun/Node and native installer tools.
- **Forbidden:** application or SDK source internals, Electrobun imports/dependency, a fake host or agent,
  production packages importing this package, or real-user state mutation during tests.

The root smoke commands execute the CLI, desktop and installer entrypoints directly. Browser E2E
orchestration stays in [[module-browser-e2e]] and imports the pure locator through this package's barrel.
Unit tests and strict typechecking use ordinary workspace Turbo tasks; there is no package build step,
SDK preparation, declaration generation, or Playwright test discovery here. Product unit tests remain
with their owning modules.

## Artifact verification

Shared probes boot the real artifact, load a synthetic external PI extension with no pi executable (the
fixture value-imports a bare `@earendil-works/pi-coding-agent` specifier and surfaces the imported value in
its model name, so the load exercises pi's virtual-module mapping through the transform path the host
forces — a bundle missing the `PI_BUNDLED_NODE` define fails this probe; [[submodule-server-agent]] owns
the seam),
exercise the bundled factories/skills, run **two scripted provider turns** — the fixture also registers a
pi-ai faux `streamSimple` under its own `api` name that calls `visualize` with a dangling flowchart edge,
so the probe asserts the strict mermaid parse error reaches the transcript as an `isError` tool result
(the packaged host composes the ThinkRail extension registry, never the portable package's best-effort
probe; [[module-ext-visualize]]), and on a second prompt calls `ask_user_question`, so the probe sees the
session block with `needsInput.kind === "tool-response"`, answers through `session.respondToTool`, and reads
the answer back as the call's non-error tool result (the registry's per-session composition and the host
mailbox inside the artifact; [[module-ext-ask-user-question]]) — start pi's bundled MCP engine in a real chat (a written-out
stdio fixture must report *connected · 1 tool* and an in-probe HTTP server that answers 401 with
protected-resource metadata *needs sign-in*, read back through `mcp.list`, which proves the lazily imported
MCP runtime executes inside the artifact), reach an OAuth URL without a provider turn, verify health/UI
and transcript trash, and shut down. CLI-specific probes also check its exit-only and embedded-cache behavior.
On Windows both smokes first read executables' resources, without running them:
- the CLI smoke reads the built exe;
- the desktop smoke reads the bundle's `bin/bun.exe`, `bin/launcher.exe` and `Resources/uninstall`.

Each executable must pass two checks, and each fails the release before publication:
- **Icon.** The group the shell shows is the first in resource order; in a Bun exe, Bun's named
  `IDI_MYICON` shadows any numbered group. That group must include the ICO's largest frame and hold
  only frames of that ICO. The reference ICO is shared's `windowsIconPath` for the CLI, and the bundle's
  own `Resources/app.ico` for the desktop.
- **VERSIONINFO.** It must equal [[module-shared]]'s `windowsFileIdentity` for the checkout's release
  identity, so a smoke runs in the same stamped checkout that built the artifact.

The resource-directory walk is local because `pe-library` refuses Bun's `.bun` section after `.rsrc`;
`resedit` parses the icon-group and version structures.
Native desktop smoke loads the real UI and verifies route/preload messaging plus the production external
navigation path against a cross-origin loopback server that stands in for the internet. A scripted
navigation, a plain link, a `_blank` link and `window.open` must each record exactly one external open and
send no request to their URL, so the window never left its origin. A sandboxed `srcdoc` iframe that
updates in place must fetch both of its images, so previews still render under the navigation rules. The
server is `unref`ed: a failed launch cannot keep the smoke alive. On macOS it also drives the title-bar double-click path end to end: a no-drag
double-click must not act, and the header double-click's recorded action and resulting window state must
match the machine's `AppleActionOnDoubleClick` setting mapped as [[module-desktop]] documents (unset,
`Maximize` and `Fill` zoom). Linux skips it because its decorated window has no web drag region;
Windows skips it because its native caption hit already maximizes on double-click. On Windows it instead clicks the HTML maximize button and then its
Restore successor in the live webview; the launcher must record exactly one `toggleMaximize` request per
click and publish the matching `maximized` state, proving the real bridge request leg and native state
push rather than a fake bridge. Close is not probed: it shares the native-X `requestClose()` path, and the
subsequent external-navigation probes need the window. Desktop-backed Playwright uses the launcher's opt-in neutral-window seam so it is the
only hydrated client. The live-window ready/control seam remains in the launcher, never a runtime import
of this package.

Normal artifact children set `CI=1` to mute every analytics tier without changing the production runtime mode; `THINKRAIL_NO_ANALYTICS`
alone suppresses only additional events. `bun run smoke:desktop --analytics [launcher]` instead runs a
controlled hidden-host probe against a loopback PostHog collector, never the vendor endpoint. It removes
inherited CI/test/optional mutes and proxies for human-mode launches, checks first packaged initialization
emits `app_installed` before `app_started`, checks restart emits only `app_started`, and pins standard
desktop/release/platform provenance plus one UUID across both (including additional opt-out). Any
`$exception` error report a launch happens to emit stays outside that launch sequence but must share the
UUID, stay personless, and carry only allow-listed plain properties. It then proves
CI and test mutes independently. No UI action or confirmation is simulated; delivery is checked after normal
host shutdown. The expected release identity is the shared identity used to build the artifact, so the
probe needs a release-stamped (keyed) artifact; an unstamped build correctly emits nothing.

Every host owns isolated home, data, agent and cache directories; environment overrides respect Windows'
case-insensitive keys. The native UI launch pre-creates its home directory: on macOS the window never
reaches DOM-ready when `XDG_CACHE_HOME` is set while `HOME` names a missing directory. Readiness polling owns a finite deadline and observes early root exit; because the launcher writes its ready, route and navigation-probe documents non-atomically, the smoke treats a missing or half-written JSON file as "not yet" and keeps polling rather than failing on a torn read. When a live
launched root or validated ready-document app/launcher PIDs need failure cleanup, teardown is bounded and
awaited before shared retrying removal of the temporary installation root. A setup root may exit successfully
before its app handoff is ready; after that exit, the harness does not infer or discover descendants from the
setup process. First-install smoke runs the actual DMG app, Windows ZIP setup, or Linux tarball installer,
observes the installer's automatic app launch, checks health and normal control-file shutdown, and waits for
installer/host/launcher exit. The harness-only installer UI autoclose flag dismisses completion dialogs, not
errors or assertions.

Windows installer smoke is permitted only on disposable GitHub-hosted Actions runners: v2 installation
writes real known-folder shortcuts and HKCU registration beyond HOME isolation. The guard runs before
creating files or launching the installer. Other native smoke still isolates both HOME and USERPROFILE.

Locators resolve the documented app/installer paths and channel-specific setup names, not the first
matching artifact from an ambiguous directory. Windows setup suffixes retain the stable/canary distinction.
A macOS run is not evidence of Windows/Linux native execution or download-time Gatekeeper acceptance.
Signing/notarization verification belongs to [[module-ci-release]]'s private service handoff.
