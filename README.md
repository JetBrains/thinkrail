# ThinkRail

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

A ThinkRail-branded desktop-and-mobile client for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent. ThinkRail is a thin host that runs `pi` in-process and bridges it to a rich, mobile-first
UI — `pi` owns models, skills, compaction, cost, and session state; the app owns the workspace, the
editor, and the wire.

**Website:** [thinkrail.ai](https://thinkrail.ai/) — a landing page that *is* the IDE, its blog,
and the [vibecoder-focused experience](https://thinkrail.ai/vibecoding/) (see
[`apps/website`](apps/website)).

**V1 is a Worktree IDE:** open a git repo as a project, spin up workspaces as `git worktree`s (each its
own branch and cwd), and work across a tabbed Monaco editor, git Changes view, terminals, a read-only
spec-graph viewer, and multiple concurrent `pi` chat sessions — all scoped to the active worktree.

## Install

ThinkRail ships in two additive forms: a native desktop installer and the self-contained `thinkrail`
CLI, which opens the same app in your browser. Both embed the same in-process agent host and are
published with `SHA256SUMS` on the [releases page](https://github.com/JetBrains/thinkrail/releases).

JetBrains signs the Windows CLI and desktop setup executable. The macOS CLI is signed but not yet
notarized. Signed/notarized desktop DMGs require the coordinated JetBrains service pipeline; older
published DMGs and local Electrobun packages may still be unsigned and blocked by Gatekeeper. Linux
artifacts are unsigned. Local installer smoke is not notarization verification.

### Desktop

Download the matching `thinkrail-desktop-*` asset: a DMG for macOS Apple Silicon, a setup ZIP for Windows
x64, or a setup tarball for Linux x64/ARM64. Extract the complete Windows ZIP before running its setup
executable, keeping its adjacent payload; extract the Linux tarball and run `installer`. Electrobun 2.0.1
does not provide a macOS Intel desktop build. The coordinated macOS release pipeline uses Electrobun's
expanded app archive for JetBrains signing and SRE DMG finalization; that intermediate archive is not a
public download. The signing limitation above remains until that private pipeline update is deployed.

Linux desktop builds require Ubuntu 24.04 or another glibc 2.38+ distribution with GTK 3, WebKitGTK 4.1,
Ayatana AppIndicator 3, and librsvg 2. On Ubuntu 24.04:

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
```

### CLI / browser

The CLI installer downloads the right binary, verifies its SHA-256 checksum, and puts `thinkrail` on
your PATH.

**macOS / Linux** (also Windows under Git Bash):

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```

**Windows** — the same command works from cmd and PowerShell:

```powershell
powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
```

Nightly builds and pinned versions:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel nightly
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --version 0.2.0
```

```powershell
# Windows — options are env vars (THINKRAIL_CHANNEL, THINKRAIL_VERSION, THINKRAIL_PREFIX, THINKRAIL_NO_MODIFY_PATH)
$env:THINKRAIL_CHANNEL='nightly'; irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex   # PowerShell
set "THINKRAIL_VERSION=0.2.0" && powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"   # cmd
```

Then run `thinkrail` (add a git repo path to open it as a project: `thinkrail ~/code/my-repo`). To update
later, run `thinkrail update` on any platform — it re-runs the installer for your channel (on Windows it
replaces the running `thinkrail.exe` in place). To remove it, run `thinkrail uninstall`: it takes out the
executable, the PATH entry the installer added, and the install metadata, and asks whether to delete your
`~/.thinkrail` app state (kept by default — pass `--remove-data` to delete it, `-y` to skip the
questions). `thinkrail --help` lists the flags; `thinkrail --version` prints the build.

**Prebuilt platforms:** macOS (Apple Silicon), Linux arm64 + x64, Windows x64 (`.exe`). Intel macOS isn't
prebuilt — use Apple Silicon or build from source.

> Prefer a manual CLI install? Download a binary + `SHA256SUMS` from the releases page, verify the
> checksum, `chmod +x`, and move it onto your PATH.

**Runtime prerequisites:** `git` on PATH, and an authenticated `pi` provider (the agent runs against your
real provider credentials). App state lives under `~/.thinkrail`.

## Quick start

### Prerequisites (developing ThinkRail)

- **Bun** 1.4.0 (the repository's pinned package manager and runtime)
- **Node.js** ≥ 22.19 (required by the in-process `pi` engine)
- An authenticated `pi` provider (the agent runs against your real provider credentials)

### For developers

```bash
git clone <repo-url>
cd thinkrail
bun install
bun run dev
```

`bun run dev` boots the host and the web client together. Press `Ctrl+C` to stop.

To run the V1 launchers:

```bash
bun run --filter @thinkrail/cli dev  # browser launcher
bun run build:binary                 # standalone CLI artifact
bun run desktop:dev                  # package and open the Electrobun app
bun run desktop:build                # package without opening it
```

Desktop commands use the standard Electrobun CLI/configuration. Its pre-build hook builds the shared UI
and stages ThinkRail's PI/native resources; Electrobun owns preload bundling and installer creation.
Create host-native installers with `bun run desktop:package:stable` or `bun run desktop:package:canary`.
Native/installer smoke and shared CLI/desktop probes live in `packages/artifact-tests`, outside the
application packages. Run `bun run smoke:desktop` after a dev build; installer smoke takes an artifact
path and channel via `bun run smoke:desktop:installer <path> <stable|canary>`.

On-disk app state (projects, workspaces, worktrees) lives under `~/.thinkrail`.

## Architecture (three rings)

- **Engine host** — `packages/server` (+ `packages/shared`), launched by `apps/cli` or
  `apps/desktop`. `createServer()` is a `Bun.serve` HTTP+WS host with an `AgentSessionManager` (one
  in-process `pi` `AgentSession` per tab).
- **The wire** — `packages/contracts`: the typed, versioned protocol (types-only).
- **UI client** — `apps/web`: mobile-first React 19 + Zustand + Tailwind v4, ships independently and
  dials a host over the wire.

The engine is **`pi` only, run in-process** via `@earendil-works/pi-coding-agent`. `apps/web` depends on
`packages/contracts` only — never on the server — which is what makes the UI shippable on its own.

See [`goal-and-requirements.md`](goal-and-requirements.md) and [`architecture.md`](architecture.md) for
the canonical product and design specs.

## Repo layout

```
apps/
  cli/        V1 entrypoint: boot host + open browser
  web/        mobile-first UI client
  desktop/    Electrobun local-host launcher + native packaging
  website/    public landing + blog + vibecoding site (Cloudflare Pages)
packages/
  artifact-tests/ source-only CLI/desktop artifact and installer tests
  server/     createServer(): Bun.serve + AgentSessionManager
  contracts/  the wire (types-only)
  shared/     server-side helpers (shellEnv, freePort)
  spec-graph/ portable pi extension: spec_* tools + skill
```

## Development

Fast gates (also the husky pre-commit hook):

```bash
bun run lint        # biome
bun run typecheck   # tsc across all packages
bun run test        # unit tests (root tooling + each package)
```

End-to-end tests drive the real web UI against isolated hosts. The no-agent gate builds once and
uses a machine-adaptive number of independent shards (half the available CPUs, capped at eight):

```bash
bunx playwright install chromium                    # one-time
bun run e2e                                         # complete no-agent gate
bun run e2e -- e2e/changes.spec.ts                  # focused iteration
bun run e2e -- --last-failed                        # repair loop
bun run e2e:serial                                  # one-host debugging fallback
bun run e2e -- --shards=12                          # explicit 1–16 override
bun run e2e:binary                                  # packaged CLI host (build first)
bun run e2e:desktop                                 # packaged desktop host (build first)
bun run e2e:full                                    # everything; needs pi auth
bun run e2e:agent                                   # only @agent; remains serial
```

On macOS, every public browser E2E command prevents idle system sleep while its runner is alive; the
display may still sleep normally.

## Specification-driven development

ThinkRail is developed spec-first: hierarchical, interconnected specs live in the repo alongside the
code — top-level specs at the root (`goal-and-requirements.md`, `architecture.md`) and a co-located
`SPEC.md` for every module. When you change a boundary, contract, or decision, update the corresponding
spec in the same change. See [`AGENTS.md`](AGENTS.md) for the spec workflow.

## Analytics & Privacy

ThinkRail sends basic usage events to [PostHog EU](https://posthog.com): launches, chat creation,
accepted message sends, and provider connections. These are always on in desktop, CLI, and source runs;
CI and automated tests are silent. Events include a random installation ID, version/channel, build kind,
OS/architecture, send mode, catalog-bucketed provider/model names, and the observed authentication
category (API key, subscription sign-in, OAuth, Central, or other/unknown)—never credential values or
account/plan details. First observed launch measures first use, not a completed OS installation.

Additional setup, run-outcome, task, review, and PR statistics require explicit consent in the first-launch
window. Its switch starts from your saved analytics preference; confirming records your choice. Change it
later in **Settings → Privacy**. `--no-analytics` or `THINKRAIL_NO_ANALYTICS=1` suppresses additional events
for that run only; basic reporting remains on.

Neither tier collects prompts, code, transcripts, file/repository names or paths, credentials, or token/cost
counts. The installation ID links usage over time, but no person profiles are created and GeoIP enrichment
is disabled. The [analytics spec](packages/server/src/analytics/SPEC.md) defines the event boundaries.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). This project and community are
governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
