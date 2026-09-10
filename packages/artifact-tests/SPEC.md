---
id: module-artifact-tests
type: module-design
status: active
title: Native artifact test harnesses
parent: architecture
depends-on: [module-cli, module-server, module-shared]
references: [module-desktop, module-browser-e2e, module-ci-release]
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
- **Allowed deps:** CLI's public artifact-name helper; server's sanctioned history-fixture export;
  shared retrying teardown; read-only access to `.github/actions/build-binary/action.yml` for executing
  its packaging invocation and collector in isolated fixture directories; Bun/Node and native installer
  tools.
- **Forbidden:** application or SDK source internals, Electrobun imports/dependency, a fake host or agent,
  production packages importing this package, or real-user state mutation during tests.

The root smoke commands execute the CLI, desktop and installer entrypoints directly. Browser E2E
orchestration stays in [[module-browser-e2e]] and imports the pure locator through this package's barrel.
Unit tests and strict typechecking use ordinary workspace Turbo tasks; there is no package build step,
SDK preparation, declaration generation, or Playwright test discovery here. Product unit tests remain
with their owning modules.

## Artifact verification

Shared probes boot the real artifact, load a synthetic external PI extension with no pi executable,
exercise the bundled factories/skills, reach an OAuth URL without a provider turn, verify health/UI and
transcript trash, and shut down. CLI-specific probes also check its exit-only and embedded-cache behavior.
Native desktop smoke loads the real UI and verifies route/preload messaging plus the production external
navigation handler. Desktop-backed Playwright uses the launcher's opt-in neutral-window seam so it is the
only hydrated client. The live-window ready/control seam remains in the launcher, never a runtime import
of this package.

Window-chrome acceptance uses real packaged windows and genuine native pointer/keyboard input. It covers
control clearance and platform placement, all resize edges, drag-from-maximized, configured header gestures,
system menus, Windows 11 Snap Layout hover, fullscreen/reload, scaling/display changes and graceful close.
A synthetic `WM_NCHITTEST` response or drag-to-top maximize does not establish the Snap flyout. Linux X11
and Wayland-session XWayland results are labelled separately; neither proves native Wayland. Native drivers
remain in this test workspace, never in the application package. An unqualified Windows adapter can be
exercised only through the launcher's isolated `THINKRAIL_DESKTOP_CHROME_PROBE_FILE` live-window seam;
its native observations and fixed control commands do not enable the ordinary production policy.

`bun packages/artifact-tests/chromeSmoke.ts [--launcher expanded/bin/launcher.exe] [--evidence-dir directory]`
is a Windows x64 **candidate state/geometry smoke**, not native acceptance. It copies the finished bundle
outside the repository, uses credential-free isolated profile/data/cache paths and offline/analytics flags,
and retains a fresh evidence directory with logs, raw observations and results even on failure. The pinned
launcher's `ELECTROBUN_CONSOLE=1` keeps application output on the redirected handles in stable/canary as well
as development artifacts. It checks health, owned HWND/PID identity, restored/maximized/fullscreen states,
fullscreen document reload and frame
restoration from both restored and maximized entry, including state-specific inset restoration; null geometry
never passes. Native fullscreen detection
matches the pinned SDK's popup/overlapped style predicate and does not erase a retained maximized bit.
A hidden public-Win32 inspector guards command issuance and polls foreground ownership, aborting rather
than reactivating after focus loss. Normal control-file shutdown runs
in finally; a private Job Object assigned before launcher resume bounds fallback cleanup to owned descendants.
Stop-file write errors do not bypass the independent outer shutdown deadline. If the inspector itself does not
finish within that grace, its retained subprocess handle is terminated; closing its private kill-on-close job
bounds that fallback without looking up or killing broad process names.
DWM caption bounds, raw `TITLEBARINFOEX` (including negative-height title rectangles) and synthetic edge hits
are diagnostics only. Results always carry `fullParity=false`: genuine input/Snap/resize/gesture behavior,
visual clearance, DPI/display/theme changes, accessibility (MSAA/UIA) and cross-platform qualification remain
uncovered. It takes no screenshots, performs no GUI input and does not enable ordinary Windows policy.

Every host owns isolated home, data, agent and cache directories; environment overrides respect Windows'
case-insensitive keys. Temporary installation roots use shared retrying removal. First-install smoke
runs the actual DMG app, Windows ZIP setup, or Linux tarball installer, observes the installer's automatic
app launch, checks health and normal control-file shutdown, and waits for installer/host/launcher exit.
The harness-only installer UI autoclose flag dismisses completion dialogs, not errors or assertions.

Windows installer smoke is permitted only on disposable GitHub-hosted Actions runners: v2 installation
writes real known-folder shortcuts and HKCU registration beyond HOME isolation. The guard runs before
creating files or launching the installer. Other native smoke still isolates both HOME and USERPROFILE.

Locators resolve the documented app/installer paths and channel-specific setup names, not the first
matching artifact from an ambiguous directory. Windows setup suffixes retain the stable/canary distinction.
A macOS run is not evidence of Windows/Linux native execution or download-time Gatekeeper acceptance.
Signing/notarization verification belongs to [[module-ci-release]]'s private service handoff.
