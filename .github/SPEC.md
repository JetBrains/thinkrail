---
id: module-ci-release
type: module-design
status: active
title: CI & release pipeline
parent: architecture
---

## Responsibility

The repo's automation: PR **gates** and the multi-platform **release** pipeline. The shippable artifact
is the single-file `thinkrail` binary that `apps/cli` produces (`build:binary` / `smoke:binary` — see
`module-cli`); this module builds it for every platform, stamps a release version into it, and publishes
GitHub releases. It owns no product code — only workflows, composite actions, and the version script.

## CI vs release

- **CI** (`ci.yml`, on PRs to `main`): lint+typecheck (incl. `check:seams` — the pi binary-seam canary,
  see `scripts/check-binary-seams.ts`), unit tests, no-agent e2e, and a **host-target** binary
  build+smoke+**e2e-vs-binary** (`bun run e2e:binary`: the same no-agent suite against the compiled
  artifact, minus the `@dev-seam` fake-login specs — the regression class that only exists inside the
  binary; ubuntu only by decision, see `task-artifact-verification`). Fast, no provider auth. Gates
  merges.
- **Release** (`nightly.yml` / `stable.yml` → `_release.yml` → `_build.yml`): trusts a green `main` (no
  test gate of its own) and produces published binaries + a GitHub release.

## Channels

Both channels are `main`-only, versioned by `scripts/next-version.sh` (channel-aware semver from git
tags: `vX.Y.Z` stable, `vX.Y.Z-nightly.N`):

- **Nightly** — cron 06:00 UTC + manual dispatch. Computes the next nightly, **skips when no commits**
  since the last one, publishes a **prerelease** `vX.Y.Z-nightly.N`.
- **Stable** — manual dispatch with `bump = patch|minor|major|explicit`. Publishes `vX.Y.Z`. The script
  guards that a minor/major bump clears any in-flight nightly base; patch hotfixes ship out-of-band.

## Build strategy — native OS matrix

`_build.yml` compiles the binary on **five native runners**, each passing its own matching `--target`
(target == host, so it's a native build with a deterministic output name):

| target             | runner             | artifact                    |
| ------------------ | ------------------ | --------------------------- |
| `bun-linux-x64`    | `ubuntu-latest`    | `thinkrail-linux-x64`       |
| `bun-linux-arm64`  | `ubuntu-24.04-arm` | `thinkrail-linux-arm64`     |
| `bun-darwin-arm64` | `macos-14`         | `thinkrail-darwin-arm64`    |
| `bun-windows-x64`  | `windows-latest`   | `thinkrail-windows-x64.exe` |

`bun-darwin-x64` (Intel mac, `macos-13`) is **commented out** in `_build.yml`: that runner's queue is
long enough to stall every release. Re-enable the matrix leg if macOS x64 downloads are needed.

(Four platforms ship today; the fifth, `darwin-x64`, is disabled for runner-queue latency — see below.)

**Why native, not cross-compile from one host.** The binary embeds a native FFI lib (`bun-pty`, loaded
via `dlopen`). Building on the target OS embeds *that platform's* real lib and lets `smoke:binary` boot
the artifact on the real OS. Bun *can* cross-compile all five from one Linux host (`bun-pty` ships every
platform's lib in one npm package), but embedding a `dlopen`'d FFI lib into a `--compile` output is a
bug-prone, host-target-only-proven path here, and a cross-built artifact can't be smoke-tested — and you'd
still need native runners to verify it, so cross-compile saves little. It stays a documented fallback.
`windows-arm64` (no stable Bun target), `linux-*-musl`, and notarization are deferred.

## Version stamping

A released binary is self-identifying. The build stamps `apps/cli/src/version.ts` (a committed source
module whose from-source default is `0.0.0-dev`) in the throwaway CI checkout before `build:binary`, so
the compiled binary reports the real `{version, channel, commit}`. It surfaces via `thinkrail --version`
and, threaded `apps/cli` → `bootHost` → `createServer`, in the `server.welcome` push
(`ServerWelcome.appVersion`, an optional field — non-breaking, no `PROTOCOL_VERSION` bump). See
`module-cli`. `version.ts` is the **only** thing the build stamps: analytics carries no key seam here,
because every channel reports to one committed project key (`submodule-server-analytics`) — and a CI run
never sends anyway, since the analytics module mutes on `CI`.

## Parts

- `CODEOWNERS` — every path is owned by @rsolmano, @danyaberezun, @OLavrik; the `main` ruleset's
  pull-request rule (`require_code_owner_review`) makes an approval from one of them required to merge.
- `scripts/next-version.sh` — channel-aware semver from tags; carries a `--tags=` override for testing.
- `actions/build-binary` — the release build step: `build:web` → stamp `version.ts` → `build-binary.ts
  --target` → resolve artifact path → native `smoke:binary`. (The Bun replacement for the old repo's
  PyInstaller action.)
- `actions/make-checksums` — writes `SHA256SUMS` over the release artifacts.
- `actions/codesign` — JetBrains CodeSign client wrapper; **wired but disabled** (`_release.yml`'s `sign`
  job is `if: false`). Binaries ship unsigned until secrets + a signing runner are provided.

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
change the asset names in `_build.yml`/`build-binary` and **both installers** must change in lockstep.
The README documents the user-facing install. `thinkrail update` (the CLI's self-update, see
`module-cli`) re-invokes `install.sh` on macOS/Linux — the installers stay the one place the
download/verify/PATH logic lives; on Windows it prints the `install.ps1` one-liner instead of updating
in place.

## Boundary

- **Owns:** everything under `.github/` (workflows, composite actions, the version script) — the CI +
  release automation and the artifact/version contract.
- **Consumes:** `apps/cli`'s `build:binary` / `smoke:binary` and its `version.ts` stamping seam; the
  repo's root scripts (`build:web`, `lint`, `typecheck`, `test`, `e2e`). It **injects** the version at
  build time but does not otherwise reach into product code.
- **Forbidden:** baking release logic into product code (the pipeline calls the same scripts a developer
  runs); a release-only build path that CI never exercises (CI builds+smokes the host target every PR).

## Get right

- **Native build == correct lib.** Don't collapse the matrix to a cross-compile job to save minutes
  without re-proving `bun-pty` FFI embedding per target and finding another way to smoke each artifact.
- **`server.welcome` stays additive.** `appVersion` is optional; adding wire fields that clients can
  ignore doesn't bump `PROTOCOL_VERSION`. A field clients must understand does.
- **Windows has no real SIGTERM** — `smoke:binary` relaxes its clean-exit assertion there (Bun
  force-terminates); it still requires the binary to boot, serve the UI, stage skills, and terminate.
