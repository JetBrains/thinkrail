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
