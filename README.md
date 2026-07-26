# ThinkRail

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

A ThinkRail-branded desktop-and-mobile client for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent. ThinkRail is a thin host that runs `pi` in-process and bridges it to a rich, mobile-first
UI — `pi` owns models, skills, compaction, cost, and session state; the app owns the workspace, the
editor, and the wire.

**Website:** [thinkrail.ai](https://thinkrail.ai/) — a landing
page that *is* the IDE (see [`apps/website`](apps/website)).

**V1 is a Worktree IDE:** open a git repo as a project, spin up workspaces as `git worktree`s (each its
own branch and cwd), and work across a tabbed Monaco editor, git Changes view, terminals, a read-only
spec-graph viewer, and multiple concurrent `pi` chat sessions — all scoped to the active worktree.

## Install

ThinkRail ships as a single self-contained executable per platform. The installer downloads the right
build from the GitHub releases, verifies its SHA-256 checksum, and puts `thinkrail` on your PATH.

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
later, run `thinkrail update` (re-installs the latest build for your channel; macOS/Linux only — on
Windows, re-run the installer). `thinkrail --help` lists the flags; `thinkrail --version` prints the
build.

**Prebuilt platforms:** macOS (Apple Silicon), Linux arm64 + x64, Windows x64 (`.exe`). Intel macOS isn't
prebuilt — use Apple Silicon or build from source.

> Prefer a manual install? Download a binary + `SHA256SUMS` from the
> [releases page](https://github.com/JetBrains/thinkrail/releases), verify the checksum, `chmod +x`, and
> move it onto your PATH.

**Runtime prerequisites:** `git` on PATH, and an authenticated `pi` provider (the agent runs against your
real provider credentials). App state lives under `~/.thinkrail`.

## Quick start

### Prerequisites (developing ThinkRail)

- **Bun** ≥ 1.3 (the package manager and runtime)
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

To run the V1 CLI entrypoint (boots the host in-process and opens the browser):

```bash
bun run --filter @thinkrail/cli dev
# or build the standalone binary:
bun run build:binary
```

On-disk app state (projects, workspaces, worktrees) lives under `~/.thinkrail`.

## Architecture (three rings)

- **Engine host** — `packages/server` (+ `packages/shared`), launched by `apps/cli`. `createServer()` is
  a `Bun.serve` HTTP+WS host with an `AgentSessionManager` (one in-process `pi` `AgentSession` per tab).
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
  desktop/    Electrobun launcher — deferred
  website/    public landing page (GitHub Pages)
packages/
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
bun run test        # unit tests (bun test, per package)
```

End-to-end tests drive the real web UI against a booted host on an isolated state dir:

```bash
bunx playwright install chromium   # one-time
bun run e2e          # no-agent suite (fast, no auth)
bun run e2e:full     # everything, including @agent specs (needs pi authenticated)
bun run e2e:agent    # only the @agent specs
```

## Specification-driven development

ThinkRail is developed spec-first: hierarchical, interconnected specs live in the repo alongside the
code — top-level specs at the root (`goal-and-requirements.md`, `architecture.md`) and a co-located
`SPEC.md` for every module. When you change a boundary, contract, or decision, update the corresponding
spec in the same change. See [`AGENTS.md`](AGENTS.md) for the spec workflow.

## Analytics & Privacy

Released ThinkRail builds send **anonymous usage analytics** to [PostHog](https://posthog.com) (EU
cloud; on by default; a notice is printed the first time anything is sent). The data answers product
questions — how many installs are active, on which versions/platforms, which models and providers
get used, and which features matter — and nothing more.

**The only stable identifier** is a random per-install id (a `uuid4`) minted on your machine and
stored in `~/.thinkrail/installation.json`; it never leaves the host except as the anonymous
`distinct_id` on events. Events additionally carry only low-cardinality, non-personal metadata: app
version, release channel (`stable`/`nightly`), OS (`macos`/`linux`/`windows`), architecture
(`x64`/`arm64`), and — on chat/login events — the model/provider name **only if it is a pi built-in**
(anything user-configured is reported as `custom`). Events are sent **personless** (no person
profiles are ever built) and with **GeoIP lookup disabled**.

**Never collected:** file paths or names, prompts, code, chat transcripts, API keys, token counts,
hostnames, usernames, or IP-derived fields. **Only stable and nightly release builds ever send**:
development builds (`bun run dev`, from-source runs, e2e) carry no analytics key, and analytics
activates exclusively on the `stable`/`nightly` release channels — there is no way (not even an
environment variable) to make a dev run emit events.

Turn it off any time:

- **In-app:** Settings → **Privacy** → toggle off (saved on the host, synced to every client).
- **Per run:** `thinkrail --no-analytics` (or `THINKRAIL_NO_ANALYTICS=1`) — mutes that run without
  touching the saved setting.

Turning analytics off stops all sending immediately; the install id is kept (never rotated) and simply
goes unused until you turn it back on.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). This project and community are
governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
