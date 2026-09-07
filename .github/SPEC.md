---
id: module-ci-release
type: module-design
status: active
title: CI & release pipeline
parent: architecture
depends-on: [module-cli, module-desktop, module-shared, module-repo-scripts, module-artifact-tests]
---

## Responsibility and boundary

Public PR gates and reusable native build recipes. Release orchestration, signing/notary credentials,
source authorization, tags, checksums and publication belong to `JetBrains/thinkrail-signing`. The current
integration follows its [build → sign → publish coordinator](https://github.com/JetBrains/thinkrail-signing/pull/4),
not the retired unsigned-draft discovery/scheduled-signing flow. The private repository's spec owns that
orchestration; this module owns the public action inputs/outputs and artifact/version contract it consumes.

- **Owns:** public CI/site workflows, native build recipes, version calculation, and
  the artifact interface consumed by the private controller.
- **Consumes:** CLI and desktop build commands, [[module-artifact-tests]] smoke entrypoints, shared
  version stamping, root conformance/unit/browser commands, git and native platform tools.
- **Forbidden:** product runtime logic, another public release controller, public signing credentials,
  publication before required signing/verification, checksums over pre-signing bytes, or a release-only
  application build path that bypasses the normal framework configuration.

## Public CI

Bun setup reads the root `package.json` `packageManager` pin through `bun-version-file`; there is no
second workflow version. Desktop's packaged runtime remains Electrobun-owned, see [[module-desktop]].

PRs and merge-queue checks run dependency/boundary/seam/spec-surface gates, lint/typecheck, unit tests and
no-agent E2E. Native CLI builds/smokes run on Linux and Windows; Linux additionally runs the browser suite
against its compiled binary. Desktop PR coverage builds the Linux host target, runs native-window/shared
artifact probes under Xvfb with test-only software-rendering flags, and runs desktop-backed browser E2E.
Real-provider tests remain opt-in. Native macOS and Linux ARM64 acceptance belongs to the release matrix;
Linux/Windows results are never inferred from a macOS-only local run or vice versa.

Windows gates PRs because its executable, environment, path and trash behavior has previously broken
otherwise green release matrices. An all-or-nothing native release matrix must surface a failed target,
not publish only the platforms that happened to pass.

## Native build and delivery contract

The private native matrix checks out the selected public source commit and invokes the checked-out
`.github/actions/build-binary` recipe. The action accepts `version`, `channel` and host-matching `target`,
and retains four outputs: `artifact-name`, `artifact-path`, `desktop-artifact-name`, `desktop-artifact-path`.
The additive `desktop-app-archive-path` output names Electrobun's official expanded macOS app archive
(empty for other targets); the private build job uploads it only as a same-run signing intermediate.
It stamps the common version, builds/smokes the CLI, invokes the official Electrobun dev and channel build
commands, runs expanded-app and first-install smoke, and collects the two artifact families.
[[module-artifact-tests]] owns the isolated contract tests that execute this action's collector against
fixture outputs for each supported target/channel; the action and delivery contract remain owned here.

Supported desktop targets and public download names:

| Target | Native runner | Desktop asset |
| --- | --- | --- |
| `bun-darwin-arm64` | `macos-14` | `thinkrail-desktop-darwin-arm64.dmg` |
| `bun-windows-x64` | `windows-latest` | `thinkrail-desktop-windows-x64.zip` |
| `bun-linux-x64` | `ubuntu-24.04` | `thinkrail-desktop-linux-x64.tar.gz` |
| `bun-linux-arm64` | `ubuntu-24.04-arm` | `thinkrail-desktop-linux-arm64.tar.gz` |

Windows/Linux aliases name the untouched framework installers. For macOS, the private JetBrains SRE
flow finalizes a conventional DMG containing the signed expanded app; it replaces the unsigned framework
DMG under the same published alias without rewriting Electrobun's self-extractor payload. The Windows
ZIP contains its setup executable and hidden payload; Linux's setup tarball contains the installer and README. The collector selects the exact framework filename for the requested target and
channel, never a first wildcard match. Stable framework installers omit the `stable-` prefix; nightly
uses Electrobun's `canary` prefix/suffix. Updater metadata and patches are not release uploads in this
scope. Changing the published aliases requires coordinating the private signing workflow's archive
handling and explicit asset allowlists, not merely renaming one public output.

Electrobun 2.0.1 has no macOS x64 core. Re-enabling an Intel runner cannot create desktop support; any
future Intel CLI-only release is a separate matrix/delivery decision. Linux uses native WebKitGTK,
Ubuntu 24.04+/glibc 2.38, and the declared GTK/WebKitGTK/AppIndicator/RSVG dependencies. CEF and additional
MSI/DEB/RPM/AppImage packaging are not introduced.

## Version and publication identity

The private controller supplies an explicit public `source_sha`. The public recipe stamps only
`packages/shared/src/version.ts` with `{ version, channel, commit }` in its throwaway checkout. CLI,
Electrobun config, runtime analytics and `server.welcome.appVersion` consume this same module; no
launcher-specific version environment bridge is required. The private workflow SHA is never product
identity. No protocol-version bump is needed for the existing optional appVersion field.

Private nightly/stable entrypoints remain main-only, use the public channel-aware version script, and
build all native targets before signing. Nightly skips unchanged public source. Signing consumes same-run
`build-*` artifacts; publication consumes the complete returned signed/verified set. Only then does the
private coordinator authorize the public source commit against main, create/check the tag idempotently,
compute final-byte checksums, and publish through the release action. The four public build outputs and
published installer aliases remain compatible with that coordinator. No workflow or release is dispatched
by a local application build.

## JetBrains signing and notarization

Credentials and access to `codesign.labs.jb.gg` remain private. The internal signing runner is restricted
to the private `sign.yml` on main; native hosted build jobs do not inherit service credentials or build
product source on the internal signer. The private CodeSign action verifies its client with JetBrains
GPG keys and checksum before use and is versioned with the workflow. CodeSign and checksum generation
are private composite actions; no public compatibility copy is retained.

Existing coverage signs the Windows CLI and installer stub, and the macOS CLI binary. The Windows
payload beside its setup stub is hash-keyed and must remain byte-identical during stub replacement.
The coordinated signing update permits only Linux artifacts as unsigned passthrough. The macOS app
archive and framework DMG are not passthrough: the former is a private intermediate, and the latter is
replaced by the SRE-finalized signed/notarized DMG. The explicit allowlist prevents an unreviewed new
asset from silently acquiring unsigned-publication status.

JetBrains CodeSign supports archive/app signing and distinct notarize/staple operations. Signing alone
is not notarization. Production macOS acceptance must cover the final expanded application's native
code/resources and the final DMG, with signature, entitlement, Gatekeeper and stapled-ticket verification
on macOS. A successful local unsigned installer smoke does not establish this acceptance.

Hutch 0.24.3 mutates version metadata after `postBuild` and compresses the inner app before `postWrap`,
so neither hook is used for premature external app sealing. The approved alternative consumes its
standard expanded `.app.tar.zst` output in the private pipeline. Hosted macOS prepares native-file and
app-archive transfers; the protected Linux runner signs native Mach-O code, seals the completed app ZIP,
and notarizes it in distinct service operations. macOS then staples the app's issued ticket and creates
the final DMG with standard `hdiutil`. Separate service operations sign/notarize/staple that DMG. Final
macOS verification checks the app/container signatures, JetBrains identity, Bun entitlements, Gatekeeper
assessment, tickets and installer startup before the complete release set can be published.

No Apple login/keychain credentials are introduced, product builds never run on the internal signer,
and signing archives are never public assets. The public archive output must land before the private
signing update is activated; the merged PR #4 coordinator alone does not yet implement desktop macOS
notarization. Local fake-client and unsigned-layout tests are not live CodeSign/notary verification.

## CLI install scripts and other automation

Root `install.sh` and `install.ps1` remain CLI-only consumers: resolve a channel/tag, download the matching
`thinkrail-<os>-<arch>[.exe]` and SHA256SUMS, verify it, then install atomically. Their file names and
checksum rules do not change with desktop packaging. PowerShell retains its recorded PATH ownership,
locked-executable replacement/rollback and per-shell invocation semantics. CLI self-update invokes those
same installers rather than duplicating their logic.

Website deploy/preview workflows remain separate and contain no signing credentials. CODEOWNERS and the
main-branch review rule still protect all paths. The private coordinator owns checksum generation after
signing; neither a local build nor a public PR job publishes artifacts to users.
