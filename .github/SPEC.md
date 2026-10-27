---
id: module-ci-release
type: module-design
status: active
title: CI & release pipeline
parent: architecture
depends-on: [module-cli, module-desktop, module-shared, module-repo-scripts, module-artifact-tests]
---

## Responsibility

Public PR gates, contribution templates, and reusable native build recipes. Release orchestration,
signing/notary credentials,
source authorization, tags, checksums, and publication belong to `JetBrains/thinkrail-signing`.
This module owns the public action inputs/outputs and artifact/version contract consumed by that private
pipeline.

## Boundary

- **Owns:** public CI/site workflows, contribution templates, native build recipes, version calculation,
  and the artifact
  interface consumed by the private release controller.
- **Consumes:** CLI and desktop build commands, [[module-artifact-tests]] smoke entrypoints, shared
  version stamping, root conformance/unit/browser commands, git, and native platform tools.
- **Forbidden:** product runtime logic; another public release controller; public signing credentials;
  publication before required signing and verification; checksums over pre-signing bytes; or a
  release-only application build path that bypasses normal package commands.

## CI

Workflow Bun setup reads the root `package.json` `packageManager` pin through `bun-version-file`.
Desktop's packaged runtime remains Electrobun-owned (see [[module-desktop]]).

PR and merge-queue gates cover dependency/boundary/seam/spec-surface conformance, lint/typecheck, unit and
no-agent browser tests. Linux and Windows run native CLI artifact smoke; Linux also runs browser tests
against the compiled binary. Desktop coverage builds the Linux target, runs native-window and shared
artifact probes under Xvfb with test-only software-rendering flags, and runs desktop-backed browser tests.
Windows also builds the desktop app and runs its native smoke, without browser tests (below).
The Linux binary and desktop suites and the Windows desktop smoke run on every merge group but on a PR
only when its change can affect artifacts (change classifier below). Real-provider tests remain explicitly authorized and separate.

The three browser suites dominate wall time, so each runs as a matrix of Playwright shards on separate
runners ([[module-browser-e2e]] owns the slicing). Shard counts trade runner minutes for wall time and are
tuned against observed per-job durations.

**Required gate.** The ruleset requires one check, "CI passed": an aggregate job that succeeds only when the
change classifier, conformance/lint/typecheck and unit tests succeeded and every other job either succeeded
or was skipped by the classifier. CI can then add, rename or skip jobs without a ruleset edit; renaming "CI
passed" itself blocks the merge queue. Every job carries a timeout a few times its healthy duration, so a
hung process fails its job, and with it "CI passed", within minutes instead of holding a runner for GitHub's
six-hour default.

**Change classifier.** A `changes` job diffs the PR or merge group against its base, counting a rename as
both its old and new path. When every changed path lies outside the app — the website and its analytics
package, the website workflows, README and PR screenshots, the root README, CONTRIBUTING, CODE_OF_CONDUCT
and LICENSE, and GitHub's issue/PR templates, CODEOWNERS and this spec — the classifier skips the pi-package, browser, binary,
Windows and desktop jobs; any other path, or a failed diff, runs them all. The exclusion list is a path
allow-list, never a file-type rule: Markdown is product input here (skills ship in the artifacts, specs feed
conformance gates). In the merge queue it diffs against the target branch, not the event's `base_sha`: that
is the previous entry's group head, and with HEADGREEN grouping a green head merges every entry ahead, so a
site PR queued behind an app PR must still run the full set. Conformance, lint/typecheck and unit tests
always run; they are cheap and cover the website too. A second output, `artifacts`, gates the Linux binary
and desktop suites and the Windows desktop smoke; the Linux suites replay the no-agent browser suite against built artifacts and cost over half of
CI's runner time: on a PR they run only when a path feeds building or packaging — the CLI and desktop apps,
artifact tests, shared's native icon set, its generator, release identity and Windows file identity, the
server's build support and bundled-runtime registration, the artifact Playwright runners, CI workflows,
actions and scripts, patches and the root manifests and lockfile — and in a merge group they always run,
so main never lands an artifact they have not exercised. An artifact-only defect in an unrelated change
therefore surfaces at enqueue time instead of on the PR; it was 1 in 56 failed runs before the split. That
includes the shared no-agent specs and fixtures the artifact suites replay: only the artifact runners and
configs are classifier paths, so a harness change that breaks only the binary or desktop replay is also
caught at enqueue. The Windows unit-and-binary job stays on every app PR: it is mostly native unit gates,
not an artifact replay.

Browser jobs retry the Playwright browser download a bounded number of times, a network fault that otherwise
ejects an entry from the merge queue; inside a job Playwright retries a failed test once on CI (source and
artifact configs alike), a test that passes on that retry is reported flaky and does not fail the job, and
no job is re-run automatically. They install Chromium without `--with-deps`: the runner image already
carries its shared libraries, and the extra apt packages (CJK/Thai/X fonts) feed no assertion while their
Ubuntu-mirror download was the slowest step of the job, often for minutes. A missing library fails
Chromium's launch loudly. The browsers themselves are not cached: the Playwright CDN download takes seconds,
no slower than an Actions-cache restore of the same bytes.

Native artifact smokes run only in shard 1: repeating an identical probe per shard adds no coverage and
multiplies exposure to runner-environment faults.

Linux desktop jobs install their GTK/WebKitGTK runtime through `.github/actions/desktop-apt`, from `.deb`
files cached under a hash of the exact package versions apt plans to install after `apt-get update`. A
mirror update or a different runner image changes that plan and so the key: the previous cache is restored
by prefix, only the changed packages download, and `apt-get autoclean` drops versions the archive no longer
offers, so a slow Ubuntu mirror costs little between image releases and while an image rolls out. A cache
saved on a PR or merge-group ref is private to that ref, so the `CI cache` workflow seeds it on every push
to main, the one scope every PR and merge group can restore. The install step is bounded at ten minutes: a
mirror that trickles bytes never trips apt's own timeouts and would otherwise hold the job for hours. The
jobs start Xvfb as their own step and proceed only once an X client connects to the exported `DISPLAY`; a
server that never answers is restarted a bounded number of times, then fails the job. Beyond the suites'
single Playwright retry, only the virtual display is retried: once it is proven, the smoke and browser tests
get no further environment retries.

A platform's native behavior is proven only on that platform. Windows remains a PR gate because its
executable, environment, path, and trash behavior differs materially from POSIX hosts. Its subprocess unit
gate also exercises native descendant-console behavior, which the Linux unit run cannot prove. Its
desktop window-chrome unit gate binds the `user32.dll` frame symbols the frameless title bar relies on,
round-trips the window icon through a real window, and stamps an AppUserModelID onto real shortcuts
([[module-desktop]]). Neither gate needs the
Electrobun devkit. Its binary smoke also checks the compiled exe's icon and file properties
([[module-artifact-tests]]). A separate Windows desktop job builds the desktop app and runs the native
desktop smoke, which checks the branded `bun.exe`, `launcher.exe` and uninstaller. Only a Windows build
runs the desktop `postBuild` branding over Hutch's output ([[module-desktop]]). Before this job existed, a
branding defect first failed in the nightly release build. Its path gate (`bun run test:windows-paths`) runs
the suites that pin architecture Decision 22 on the one host where git prints `C:/…`, node prints `C:\…`,
and `\` is not a file-name character: stored directories, chat lifecycle in Default and external workspaces,
POSIX wire paths, git object names, picker roots, and `install.ps1`'s PATH check. A suite joins the gate only
once it passes on Windows. A test whose premise NTFS cannot hold, such as a `:` in a ref name or an
unprivileged symlink, is skipped there and stays covered on Linux. The gate runs with a 30 s per-test budget
instead of Bun's 5 s default: each git spawn costs ~40 ms there (the workspace suite runs about 14× slower
than on Linux, one passing test reached 4.2 s), and a runner stall such as on-access scanning of a fresh
install turns that into timeouts. Tests with an explicit timeout keep it. The runner's `TEMP` is an 8.3 short
name (`C:\Users\RUNNER~1\…`) while git reports the long one, so path fixtures are rooted at
`realpathSync.native`, the spelling git and the OS agree on. The installer file contributes only its
`install.ps1` suite, because its `install.sh` tests rightly reject the `~` such a prefix carries. Native
macOS and Linux ARM64 acceptance belongs to the release matrix. The Windows jobs install Bun and their
dependencies without the Actions cache: restoring it took longer than a fresh install, and with no Windows
job on main every PR and merge group kept its own copy, about half of the repository's cache quota.

## Native build contract

The private native matrix checks out an explicit public source commit and invokes
`.github/actions/build-binary`. The action accepts `version`, `channel`, and a host-matching `target`,
plus optional `posthog-cli-api-key` / `posthog-cli-project-id` for source-map upload (below).
Its stable public outputs are:

- `artifact-name` / `artifact-path` — native CLI;
- `desktop-artifact-name` / `desktop-artifact-path` — first-install desktop artifact;
- `desktop-app-archive-path` — Electrobun's expanded macOS app archive, empty on non-macOS targets;
- `desktop-update-manifest-path` / `desktop-update-archive-path` — Electrobun's updater metadata and
  full application archive, both non-empty on every desktop target.

The recipe stamps the shared version, builds and smokes the CLI, invokes the normal Electrobun dev and
channel builds, runs expanded-app and first-install smoke, then collects exact target/channel outputs.
Update outputs preserve Electrobun's generated basenames and compressed bytes. The manifest is the exact
`<stable|canary>-<macos|win|linux>-<arm64|x64>-update.json`. Its `artifact.file` is the archive basename:
`stable-<platform>-ThinkRail[.app].tar.zst` for stable or
`canary-<platform>-ThinkRail-canary[.app].tar.zst` for nightly, where `<platform>` is the manifest's
OS-architecture pair and `.app` occurs only on macOS. Collection resolves both names for the requested
channel and target rather than accepting the first glob match. The paths point directly
into Electrobun's output tree; updater payloads do not change the installer-only dist aliases. On macOS the
update archive may be the same expanded-app archive exposed through `desktop-app-archive-path`; the recipe
does not duplicate or repackage it. [[module-artifact-tests]] owns isolated packaging-invocation and
collector contract tests; this module owns the action and delivery contract.

Supported desktop assets:

| Target | Native runner | Published asset |
| --- | --- | --- |
| `bun-darwin-arm64` | `macos-14` | `thinkrail-desktop-darwin-arm64.dmg` |
| `bun-darwin-x64` | `macos-15-intel` | `thinkrail-desktop-darwin-x64.dmg` |
| `bun-windows-x64` | `windows-latest` | `thinkrail-desktop-windows-x64.zip` |
| `bun-linux-x64` | `ubuntu-24.04` | `thinkrail-desktop-linux-x64.tar.gz` |
| `bun-linux-arm64` | `ubuntu-24.04-arm` | `thinkrail-desktop-linux-arm64.tar.gz` |

Linux aliases name untouched framework installers. The Windows ZIP contains its setup executable and
adjacent payload; the private pipeline signs both and repacks the payload (see Signing). Linux's tarball
contains the installer and README. For macOS, the private SRE flow replaces the unsigned framework DMG
with a conventional DMG containing the signed expanded app, under the same published alias. The app
archive is a private signing intermediate, never a public release asset.

On Windows, the packaging invocation puts System32 first so Hutch's bare `tar` resolves to Windows
bsdtar; Git's GNU tar interprets drive-letter paths as remote `host:path` operands. The collector resolves
exact framework filenames. Stable installers omit the `stable-` prefix; nightly
uses Electrobun's `canary` prefix/suffix. Full updater archives and metadata are handed to the private
pipeline under their raw framework names; patch generation remains disabled. Linux requires Ubuntu
24.04+/glibc 2.38 and the declared GTK, WebKitGTK, AppIndicator, and librsvg dependencies. CEF and
additional installer formats are outside this contract.

## Release identity and trust

The release controller supplies an explicit public `source_sha`. The public recipe stamps only
`packages/shared/src/version.ts` with `{ version, channel, commit, posthogProjectKey }`; CLI, desktop
configuration, analytics, and `server.welcome.appVersion` consume that same identity. The action's
required `posthog-project-key` input is the only source of the app's analytics key — the repository
carries none — and stamping fails closed when it is empty or the channel is not `nightly|stable`. It
is a public ingestion key, not a service credential, so hosted native jobs may receive it; the private
workflow passes it from its secret store and the stamp step never echoes it. The private workflow's own commit
is never product identity.

The version itself comes from `.github/scripts/next-version.sh`, the one public version policy. It reads
`git tag -l` unless `--tags` supplies the list. The release controller passes the git tags plus the
versions its update feed still advertises, so deleting a release and its tag never frees that number.
`--tags` is therefore a consumed interface, not a test-only hook.

Signing credentials and access to `codesign.labs.jb.gg` stay in the protected private pipeline. Hosted
native jobs receive no service credentials except one owner-approved exception: a PostHog personal API
key (error-tracking write, organization read) for source-map upload. PostHog's `posthog-cli` must stamp
chunk ids into the JS before packaging and needs that key to do so, and the maps must never ship, so the
upload cannot move to a later protected job. The key reaches only the web build, `desktop:build` and desktop
packaging steps (never smokes; the identity-stamping step sees only whether it is set) and is absent from PR CI, whose builds are unchanged. Protected internal
jobs otherwise perform service calls but do not build product source or assemble archives.

**Source maps.** When `posthog-cli-api-key` is set, those steps receive
`THINKRAIL_SOURCEMAPS_RELEASE=<version>` and the CLI credentials (EU host). The web build emits hidden
maps and runs `posthog-cli sourcemap process --release-mode symbol-set --delete-after` (release
`thinkrail@<version>`); desktop's `preBuild` injects the runtime bundle's chunk id itself and uploads it
([[module-desktop]]). `@posthog/cli` is pinned once in the root catalog, and its npm wrapper downloads the
native binary on first use without any integrity check, so every invocation goes through the root
`posthog-cli` script (`apps/web/posthogCli.ts`): it refuses a wrapper version other than the pinned one and
a binary whose SHA-256 is not one of the seven pinned per platform — taken from archives whose digests
matched PostHog's GitHub release — before the binary sees the key or rewrites shipped JS. Bumping
`@posthog/cli` means re-pinning. Builds fail rather than package any
web `.map`, and turbo hashes the release variable so a cache hit restores the injected, map-free output.
The CLI binary embeds its own map instead ([[module-cli]]).

CodeSign and checksum actions are private and versioned with
the release workflow.

The pipeline fails closed: it builds every target, signs and verifies the required artifacts, computes
checksums over final bytes, authorizes the source commit against public main, creates an idempotent tag,
and only then publishes. Intermediate artifacts never enter the public release. An explicit unsigned
allowlist admits only the Linux artifacts; any new platform or unexpected file blocks publication until
its signing policy is decided.

## Signing and notarization

Windows signing covers the CLI, the setup stub, and every PE file in the stub's adjacent payload: the
launcher, `bun.exe`, framework DLLs and tools, the bundled `uninstall` helper that installs and applies
updates, and runtime libraries. Unsigned framework binaries drew Defender ML quarantines during installs
and updates. The private pipeline extracts the payload, signs its PE files, repacks it without touching
other members, and publishes those same bytes as the Windows update archive. The payload's framework
`hash` is identity metadata, not a content digest, so repacking keeps it valid. Publication requires the
finalized ZIP to pass the first-install smoke on a hosted Windows runner.
The macOS CLI keeps its independent Developer ID signing path for both `thinkrail-darwin-arm64` and
`thinkrail-darwin-x64`.

Desktop macOS signing consumes Electrobun's expanded `.app.tar.zst`, because Hutch writes final version
metadata after `postBuild` and compresses the inner app before `postWrap`. Hosted macOS prepares native
transfers; protected internal jobs sign every Mach-O file, seal the completed app ZIP, and notarize it in
a distinct operation. Hosted macOS staples the app ticket and creates the DMG. Protected jobs separately
sign, notarize, and staple that DMG.

Publication requires native macOS verification of the app and container: JetBrains signing identity,
hardened runtime, Bun entitlements, strict signature checks, Gatekeeper assessment, notarization tickets,
and first-install smoke. Signing and notarization are distinct service operations and retain explicit
content types. Entitlement extraction requests XML before plist parsing.

## Desktop updater qualification and publication

Auto-update scope includes every current native desktop target in the matrix above. Canary qualification
precedes stable; each target needs an observed installed-version A to version B upgrade before enablement.
The public build handoff now includes the raw Electrobun manifest and full archive; the private runtime feed
and publication automation are not yet live. Runtime policy belongs to [[module-desktop]].

The private pipeline consumes those raw names, finalizes the macOS application and the Windows payload
through the existing signing flow, and creates their update archives from those final bytes. It assigns
each finalized archive an immutable, version-qualified protocol-compatible basename and changes only
`artifact.file` in the corresponding framework manifest before publication. Other manifest identity fields
remain framework-generated. Payloads are uploaded and made publicly retrievable before their channel
manifests. This updater handoff adds no new signing, notarization, verification, or publication gate; the
existing platform requirements remain in force.

Native update acceptance is **manual-first**. It uses finalized release bytes in disposable installations,
records both versions and per-target results, and covers check-stops-at-available, explicit download, distinct
transfer/preparation, deferral by closing Settings, **Install & Restart**, channel isolation, interrupted
transfer/retry, post-update version/host health, and restoration of local state. Running agents and terminal
commands are not expected to survive host restart. Windows qualification uses a disposable VM/runner because
installation integrates beyond HOME. Relevant checks repeat when
Electrobun, packaging, signing or restart handling changes. This limits investment in a broad new updater
suite for an infrequently changing integration; it does not remove existing signing, artifact-smoke, fast
or complete no-agent browser gates. New automated coverage stays narrow around application-owned lifecycle
regressions and the existing public artifact-output contract tests; no dedicated updater CI matrix is required.

## CLI installation and other automation

Root `install.sh` and `install.ps1` remain CLI-only consumers: validate channel/version identity, resolve the
requested release, validate its tag against the selected channel's exact grammar before constructing any
artifact URL, download the native CLI plus `SHA256SUMS`, verify it, and stage replacement in the
destination directory before an atomic rename. Prefix checks are representation-based rather than ASCII-only:
Unicode and benign `@`/`+` components remain valid, while each platform rejects characters that would corrupt
metadata or startup-shell syntax. Git Bash writes native-readable Windows metadata; malformed shell PATH blocks
are preserved rather than rewritten. On macOS, `install.sh` selects arm64 when the shell runs under Rosetta
(`sysctl.proc_translated` is 1) even though `uname -m` reports `x86_64`, so Apple Silicon always gets the
native CLI and a translated x64 install moves to arm64 on its next self-update. CLI self-update binds
metadata to the running executable and invokes these installers rather than duplicating download/checksum
logic. Controlled script tests own these regressions; finalized Windows PowerShell/Git-Bash and custom-volume behavior remains release qualification.
The `install.ps1` suite starts PowerShell once in a warm-up hook with its own budget before its timed tests:
the first `powershell.exe` launch on a fresh hosted runner has taken up to 31 s (2–14 s in passing runs),
a one-time environment cost that no single test's budget should absorb.

Website deployment contains no signing credentials. CODEOWNERS and the main-branch rules protect the
public recipes; local builds and public PR jobs never publish user-facing release artifacts.
