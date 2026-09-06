---
id: module-ci-release
type: module-design
status: active
title: CI & release pipeline
parent: architecture
depends-on: [module-cli, module-desktop, module-shared, module-repo-scripts]
---

## Responsibility

The public repo's automation: PR **gates** and reusable **build/version recipes**. The shippable artifact
is two additive artifact families: the single-file `thinkrail` CLI binary and the Electrobun desktop
installer. The build action stamps their shared release identity, builds both, and runs their native
smokes. It owns no product code.

**Release orchestration lives in `JetBrains/thinkrail-signing` (private).** That repository owns nightly
scheduling, stable dispatch, source-commit selection, the native build matrix, existing signing,
checksums, public tags, release notes, and publication back to `JetBrains/thinkrail`. It checks out the
public source at an explicit commit and invokes this module's recipes. PR CI and the recipes remain
public; there is no public draft-release handoff. A final upload-only draft may still keep incomplete
uploads invisible until publication.

## CI vs release

- **CI** (`ci.yml`, on PRs to `main` and merge-queue check requests): dependency/module-boundary checks,
  lint+typecheck (incl. `check:seams` — the pi binary-seam canary, see `scripts/check-binary-seams.ts` —
  and `check:spec-surface`, which holds explicitly enrolled exact public surfaces to their TypeScript-resolved barrels, see
  `module-repo-scripts`), unit tests, no-agent e2e, and a **host-target** binary
  build+smoke+**e2e-vs-binary** (`bun run e2e:binary`: the same no-agent suite against the compiled
  artifact, minus the `@dev-seam` fake-login specs), a **windows-latest binary build+smoke**
  (`binary-windows`), plus a host-target Electrobun package, native-window smoke, shared artifact probes,
  and desktop-backed no-agent e2e. The Linux desktop target runs under Xvfb with CI-only software
  rendering. Fast enough for PRs, no provider auth. Gates merges.
- **Release** (private `thinkrail-signing` workflows): selects public `main`, invokes this repo's
  native build recipes at that source commit, passes artifacts between jobs within the private run,
  applies the existing signing policy, and creates the public tag/release. Moving orchestration does
  not expand signing coverage: macOS notarization and desktop updater publication remain deferred.
  The public repo contains no nightly/stable release entrypoint or reusable release orchestration.

**Why Windows gates PRs and macOS does not.** A release build is all-or-nothing: `release` needs
`build.result == 'success'`, so one red matrix leg publishes *nothing* — quietly, with no notification, and
with the other platforms' green artifacts discarded. #255 spent two nightlies and a stable dispatch that
way on a Windows-only smoke fixture defect (see `module-cli`). Windows is where the host's assumptions
diverge most (executable resolution, `PATH` shape, `USERPROFILE` vs `HOME`, real-OS trash), and its runner is
the cheap half of that risk; macOS divergence is narrower (path canonicalization) and its runner minutes are
dearer, so it stays release-matrix-only. The private release controller owns release-run failure and
missing-nightly monitoring; this public CI continues to own merge qualification.

## Version and channel contract

`.github/scripts/next-version.sh` remains the single version algorithm. Its caller runs it against the
public source checkout and public tags: `vX.Y.Z` stable, `vX.Y.Z-nightly.N` nightly. Stable supports
`bump = patch|minor|major|explicit`; minor/major must clear an in-flight nightly base, while patch
hotfixes ship out-of-band. The private controller preserves nightly's unchanged-source skip behavior.

The private workflow's own repository/SHA is not product identity. Source selection, tag lookup,
version calculation, and tag creation must all explicitly refer to `JetBrains/thinkrail`; the private
controller forwards that resolved source commit and computed version/channel to the native build
jobs. Scheduling, serialization, idempotent public tag creation, and publication belong to the private
controller rather than being duplicated here.

## Build strategy — native OS matrix

The private native matrix invokes `actions/build-binary` for each supported target below. CLI passes
its matching `--target`; Electrobun builds for the current runner so every FFI/helper/native-wrapper
path is executed where it will ship:

| target             | runner             | CLI artifact                | desktop installer |
| ------------------ | ------------------ | --------------------------- | ----------------- |
| `bun-linux-x64`    | `ubuntu-24.04`     | `thinkrail-linux-x64`       | Electrobun Linux x64 setup `.tar.gz` |
| `bun-linux-arm64`  | `ubuntu-24.04-arm` | `thinkrail-linux-arm64`     | Electrobun Linux ARM64 setup `.tar.gz` |
| `bun-darwin-arm64` | `macos-14`         | `thinkrail-darwin-arm64`    | Electrobun macOS ARM64 `.dmg` |
| `bun-windows-x64`  | `windows-latest`   | `thinkrail-windows-x64.exe` | Electrobun Windows x64 setup `.zip` |

`bun-darwin-x64` (Intel mac) remains outside the active matrix after its runner queue stalled releases.
Restoring it requires an explicit coordinated target/signing decision in the private controller.

(Four targets ship both families; `darwin-x64` remains disabled for runner-queue latency.) Electrobun's
canary channel maps to ThinkRail nightly; stable maps to stable. The release uploads first-install desktop
artifacts, not updater metadata/patches.

**Why native, not cross-compile from one host.** The binary embeds a native FFI lib (`bun-pty`, loaded
via `dlopen`). Building on the target OS embeds *that platform's* real lib and lets `smoke:binary` boot
the artifact on the real OS. Bun *can* cross-compile all five from one Linux host (`bun-pty` ships every
platform's lib in one npm package), but embedding a `dlopen`'d FFI lib into a `--compile` output is a
bug-prone, host-target-only-proven path here, and a cross-built artifact can't be smoke-tested — and you'd
still need native runners to verify it, so cross-compile saves little. It stays a documented fallback.
`windows-arm64` (no stable Bun target), `linux-*-musl`, and notarization are deferred.

## Version stamping

Every released launcher is self-identifying. The build stamps `packages/shared`'s permanent version
subpath (whose source default is `0.0.0-dev`) once in the throwaway CI checkout before either build, so
CLI and desktop report the same `{version, channel, commit}`. It surfaces via `thinkrail --version`,
Electrobun package metadata, analytics, and, threaded through `bootHost`, in the `server.welcome` push
(`ServerWelcome.appVersion`, an optional field — non-breaking, no `PROTOCOL_VERSION` bump). See
`module-cli` and `module-desktop`. The shared version module is the **only** thing the build stamps:
analytics carries no key seam here,
because every channel reports to one committed project key (`submodule-server-analytics`) — and a CI run
never sends anyway, since the analytics module mutes on `CI`.

## Parts

- `CODEOWNERS` — every path is owned by @rsolmano, @danyaberezun, @OLavrik; the `main` ruleset's
  pull-request rule (`require_code_owner_review`) makes an approval from one of them required to merge.
- `site.yml`, `site-preview.yml`, and `site-preview-cleanup.yml` — publish the website's production and
  PR artifacts; closing a preview-bearing PR removes its Cloudflare deployments and retires the link.
- `scripts/next-version.sh` — channel-aware semver from tags; carries a `--tags=` override for testing.
- The native build action: stamp the shared version → `build:web` → build/smoke the CLI binary →
  package/native-smoke/shared-probe the expanded desktop app → create and execute Electrobun's
  first-install artifact in an isolated install root → collect both artifacts. Desktop-backed e2e runs in
  CI before release; each release runner still performs both target-native desktop smoke layers.
- `actions/make-checksums` — writes `SHA256SUMS` over the release artifacts. **No caller here:** a
  signature changes the bytes, so checksums must be taken after signing. `thinkrail-signing` pins it by
  commit SHA, which is what keeps the published `SHA256SUMS` format identical to pre-signing releases.
- `actions/codesign` — JetBrains CodeSign client wrapper. **No caller here either, and there can never be
  one:** it needs the JetBrains internal network, unreachable from a public repo's runners.
  `thinkrail-signing` pins it by commit SHA. Keeping the recipe public and the credentials private is
  deliberate — do not move or delete it because it looks dead.

## Install side (`/install.sh` + `/install.ps1`)

Two repo-root installers are the **consumers** of the release — both resolve the latest tag for a
channel, download the platform asset + `SHA256SUMS`, verify the checksum, and drop `thinkrail` on PATH:

- **`install.sh`** — bash: macOS/Linux, plus Windows under Git Bash/MSYS (`curl -fsSL … | bash`).
- **`install.ps1`** — Windows-native, one script for **both cmd and PowerShell** (Windows PowerShell
  5.1-compatible): `powershell -c "irm …/install.ps1 | iex"`. Options travel as env vars
  (`THINKRAIL_CHANNEL` / `THINKRAIL_VERSION` / `THINKRAIL_PREFIX` / `THINKRAIL_NO_MODIFY_PATH`) — the
  only syntax both shells share — with mirroring params for a saved copy. It installs to
  `%USERPROFILE%\.local\bin` (same default prefix as `install.sh`, so a Git Bash install and a native
  install coincide), writes the same `~/.config/thinkrail/install.json`, appends the bin dir to the
  **user** PATH via `HKCU\Environment` (idempotent, `REG_EXPAND_SZ`-preserving, `WM_SETTINGCHANGE`
  broadcast; `-NoModifyPath` opts out). **Idempotence is judged against the *persistent* PATH only** —
  the HKCU + machine registry values, never `$env:Path`: a session-only `$env:Path +=` must not be
  mistaken for an install, or the registry write is skipped and `thinkrail` is gone from the next
  terminal. **Replacing the binary never risks the installed one**: the verified download is staged
  *inside* the bin dir first (so a cross-volume or out-of-space failure strikes before anything
  installed is touched), then swapped in by same-volume rename; a locked running exe is renamed aside
  (`thinkrail.exe.*.old`, cleaned up by the next install alongside stale `.new` stages) and restored if
  the swap then fails. A first-move failure with **no** `thinkrail.exe` present is rethrown as-is, not
  mistaken for a lock.

Both depend on the **artifact-name contract** this module produces (`thinkrail-<os>-<arch>` with `os` ∈
{`linux`,`darwin`,`windows`}, `arch` ∈ {`x64`,`arm64`}, `.exe` on Windows) and the `SHA256SUMS` file —
change the asset names in `build-binary` and the private release matrix, and **both installers** must change in lockstep.
The README documents the user-facing install. `thinkrail update` (the CLI's self-update, see
`module-cli`) re-invokes `install.sh` on macOS/Linux — the installers stay the one place the
download/verify/PATH logic lives; on Windows it prints the `install.ps1` one-liner instead of updating
in place.

## Boundary

- **Owns:** public PR/site automation, reusable native build/smoke recipes, the version algorithm,
  and the public artifact/version naming contract under `.github/`.
- **Does not own:** nightly/stable release orchestration, signing, tag writes, `SHA256SUMS` production,
  or publication. Those are `thinkrail-signing`'s; its `SPEC.md` is the source of truth for them.
- **Consumes:** `apps/cli`'s binary build/smoke, `apps/desktop`'s package/native smoke, the shared
  version-stamping seam, and root scripts (`build:web`, `lint`, `typecheck`, `test`, `e2e` and artifact
  e2e variants). It **injects** the version at
  build time but does not otherwise reach into product code.
- **Forbidden:** baking release logic into product code (the pipeline calls the same scripts a developer
  runs); a release-only build path that CI never exercises (CI builds+smokes the host target every PR);
  restoring a public nightly/stable controller, publishing a release from this repo, or writing a
  release `SHA256SUMS` before signing — those bypass the private controller or invalidate its manifest.
  Root-script conformance tests pin the absence of retired public release entrypoints and the continued
  presence of public CI/build/version recipes.

## Get right

- **Native build == correct runtime.** Do not collapse the matrix to cross-compilation without another
  way to execute each target's PTY, trash helper, Electrobun wrapper/system renderer, and normal quit path.
  Linux release additionally requires clean Ubuntu 24.04 x64/ARM64 smoke with glibc 2.38 and the declared
  GTK/WebKitGTK/AppIndicator/RSVG packages.
- **`server.welcome` stays additive.** `appVersion` is optional; adding wire fields that clients can
  ignore doesn't bump `PROTOCOL_VERSION`. A field clients must understand does.
- **Windows has no real SIGTERM** — `smoke:binary` relaxes its clean-exit assertion there (Bun
  force-terminates); it still requires the binary to boot, serve the UI, stage skills, and terminate.
- **Never bypass the private publisher.** Both installers require the final `SHA256SUMS`; manually
  publishing incomplete assets or pre-signing checksums breaks that contract. Final drafts are upload
  staging only, not inputs for a second pipeline.
- **Coordinate the two-repository cutover.** Pause the old public release triggers, finish or explicitly
  resolve their pending drafts/runs, and merge the private controller plus this public retirement in a
  maintenance window. Verify that no old run can still publish before activating the private schedule
  or dispatching a release. Do not leave two independent controllers allocating public versions.
- **Preserve current behavior, not an unsigned fallback.** This orchestration migration carries the
  existing signing coverage unchanged. New notarization/expanded-payload signing belongs to later
  work; the migration is not a claim that those distributions are already trusted by Gatekeeper.
