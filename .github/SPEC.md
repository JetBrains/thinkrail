---
id: module-ci-release
type: module-design
status: active
title: CI & release pipeline
parent: architecture
depends-on: [module-cli, module-desktop, module-shared, module-repo-scripts, module-artifact-tests]
---

## Responsibility

Public PR gates and reusable native build recipes. Release orchestration, signing/notary credentials,
source authorization, tags, checksums, and publication belong to `JetBrains/thinkrail-signing`.
This module owns the public action inputs/outputs and artifact/version contract consumed by that private
pipeline.

## Boundary

- **Owns:** public CI/site workflows, native build recipes, version calculation, and the artifact
  interface consumed by the private release controller.
- **Consumes:** CLI and desktop build commands, [[module-artifact-tests]] smoke entrypoints, shared
  version stamping, root conformance/unit/browser commands, git, and native platform tools.
- **Forbidden:** product runtime logic; another public release controller; public signing credentials;
  publication before required signing and verification; checksums over pre-signing bytes; or a
  release-only application build path that bypasses normal package commands.

## CI

Workflow Bun setup reads the root `package.json` `packageManager` pin through `bun-version-file`.
Desktop's packaged runtime remains Electrobun-owned (see [[module-desktop]]).

PR and merge-queue gates cover dependency/boundary/seam/spec-surface conformance, lint/typecheck, unit
and no-agent browser tests. Linux and Windows run native CLI artifact smoke; Linux also runs browser tests
against the compiled binary. Desktop PR coverage builds the Linux target, runs native-window and shared
artifact probes under Xvfb with test-only software-rendering flags, and runs desktop-backed browser tests.
Real-provider tests remain explicitly authorized and separate.

A platform's native behavior is proven only on that platform. Windows remains a PR gate because its
executable, environment, path, and trash behavior differs materially from POSIX hosts. Native macOS and
Linux ARM64 acceptance belongs to the release matrix.

## Native build contract

The private native matrix checks out an explicit public source commit and invokes
`.github/actions/build-binary`. The action accepts `version`, `channel`, and a host-matching `target`.
Its stable public outputs are:

- `artifact-name` / `artifact-path` — native CLI;
- `desktop-artifact-name` / `desktop-artifact-path` — first-install desktop artifact;
- `desktop-app-archive-path` — Electrobun's expanded macOS app archive, empty on non-macOS targets.

The recipe stamps the shared version, builds and smokes the CLI, invokes the normal Electrobun dev and
channel builds, runs expanded-app and first-install smoke, then collects exact target/channel outputs.
[[module-artifact-tests]] owns isolated collector contract tests; this module owns the action and delivery
contract.

Supported desktop assets:

| Target | Native runner | Published asset |
| --- | --- | --- |
| `bun-darwin-arm64` | `macos-14` | `thinkrail-desktop-darwin-arm64.dmg` |
| `bun-windows-x64` | `windows-latest` | `thinkrail-desktop-windows-x64.zip` |
| `bun-linux-x64` | `ubuntu-24.04` | `thinkrail-desktop-linux-x64.tar.gz` |
| `bun-linux-arm64` | `ubuntu-24.04-arm` | `thinkrail-desktop-linux-arm64.tar.gz` |

Windows and Linux aliases name untouched framework installers. The Windows ZIP contains its setup
executable and adjacent payload; Linux's tarball contains the installer and README. For macOS, the
private SRE flow replaces the unsigned framework DMG with a conventional DMG containing the signed
expanded app, under the same published alias. The app archive is a private signing intermediate, never
a public release asset.

The collector resolves exact framework filenames. On Windows, the release invocation puts System32
first so Hutch's bare `tar` resolves to Windows bsdtar; Git's GNU tar interprets drive-letter paths as
remote `host:path` operands. Stable installers omit the `stable-` prefix; nightly
uses Electrobun's `canary` prefix/suffix. Updater metadata and patches are not published. Electrobun 2.0.1
has no macOS x64 core. Linux requires Ubuntu 24.04+/glibc 2.38 and the declared GTK, WebKitGTK,
AppIndicator, and librsvg dependencies. CEF and additional installer formats are outside this contract.

## Release identity and trust

The release controller supplies an explicit public `source_sha`. The public recipe stamps only
`packages/shared/src/version.ts` with `{ version, channel, commit }`; CLI, desktop configuration,
analytics, and `server.welcome.appVersion` consume that same identity. The private workflow's own commit
is never product identity.

Signing credentials and access to `codesign.labs.jb.gg` stay in the protected private pipeline. Hosted
native jobs receive no service credentials; protected internal jobs perform service calls but do not
build product source or assemble archives. CodeSign and checksum actions are private and versioned with
the release workflow.

The pipeline fails closed: it builds every target, signs and verifies the required artifacts, computes
checksums over final bytes, authorizes the source commit against public main, creates an idempotent tag,
and only then publishes. Intermediate artifacts never enter the public release. An explicit unsigned
allowlist admits only the Linux artifacts; any new platform or unexpected file blocks publication until
its signing policy is decided.

## Signing and notarization

Windows signing covers the CLI and setup stub; the hash-keyed adjacent payload remains byte-identical.
The macOS CLI keeps its independent Developer ID signing path.

Desktop macOS signing consumes Electrobun's expanded `.app.tar.zst`, because Hutch writes final version
metadata after `postBuild` and compresses the inner app before `postWrap`. Hosted macOS prepares native
transfers; protected internal jobs sign every Mach-O file, seal the completed app ZIP, and notarize it in
a distinct operation. Hosted macOS staples the app ticket and creates the DMG. Protected jobs separately
sign, notarize, and staple that DMG.

Publication requires native macOS verification of the app and container: JetBrains signing identity,
hardened runtime, Bun entitlements, strict signature checks, Gatekeeper assessment, notarization tickets,
and first-install smoke. Signing and notarization are distinct service operations and retain explicit
content types. Entitlement extraction requests XML before plist parsing.

## CLI installation and other automation

Root `install.sh` and `install.ps1` remain CLI-only consumers: resolve the requested release, download
the native CLI plus `SHA256SUMS`, verify it, and install atomically. Their filename and checksum rules do
not change with desktop packaging. CLI self-update invokes these installers rather than duplicating their
logic.

Website deployment contains no signing credentials. CODEOWNERS and the main-branch rules protect the
public recipes; local builds and public PR jobs never publish user-facing release artifacts.
