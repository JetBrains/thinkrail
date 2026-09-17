# ThinkRail

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

ThinkRail is the agentic IDE that gets better every time you use it — learning your project through
living specs today, and building its own capabilities tomorrow.

We built a rich interface around the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, isolated work into separate workspaces, and gave the agent durable project knowledge
through living specs and reusable skills. Next, we're adding full extension support, so ThinkRail can
create the tools it needs based on how you actually work.

Under the hood, ThinkRail is a thin host that runs `pi` in-process and bridges it to a rich,
mobile-first UI — `pi` owns models, skills, compaction, cost, and session state; the app owns the
workspace, the editor, and the wire.

**Website:** [thinkrail.ai](https://thinkrail.ai/) — a landing page that *is* the IDE, its blog,
and the [vibecoder-focused experience](https://thinkrail.ai/vibecoding/) (see
[`apps/website`](apps/website)).

**Every workspace is a git worktree:** open a git repo as a project, spin up workspaces as `git worktree`s (each its
own branch and cwd), and work across a tabbed Monaco editor, git Changes view, terminals, a read-only
spec-graph viewer, and multiple concurrent `pi` chat sessions — all scoped to the active worktree.

## Install

### Desktop app

Download the `thinkrail-desktop-*` asset for your platform from the
[releases page](https://github.com/JetBrains/thinkrail/releases). It runs the app in its own window.

**macOS (Apple Silicon)**

Open the DMG.

**Windows x64**

Extract the whole setup ZIP and run its setup executable in place, next to its payload.

**Linux x64 / ARM64**

You need glibc 2.38+ with GTK 3, WebKitGTK 4.1, Ayatana AppIndicator 3, and librsvg 2. On Ubuntu, that means
24.04 or newer (older releases ship an older glibc and won't work):

```bash
sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
```

Then extract the setup tarball and run `installer`.

Eligible stable and nightly builds offer updates in **Settings → Updates**. Nothing installs until you choose
**Install & Restart**.

### Command line

The `thinkrail` CLI is a single self-contained binary that serves the same app to your browser.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```

**Windows**

```powershell
powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
```

Then open a repo:

```bash
thinkrail ~/code/my-repo
```

To follow the nightly channel or pin a version, the installer takes `--channel` and `--version` (on
Windows, the `THINKRAIL_CHANNEL` and `THINKRAIL_VERSION` environment variables). A pinned version must
belong to the selected channel: `--channel stable --version 0.1.5` or
`--channel nightly --version 0.2.0-nightly.20`.

Installed CLI hosts offer **Run Update** in **Settings → Updates**. `thinkrail update` upgrades in place,
`thinkrail uninstall` removes it (`--remove-data` also deletes `~/.thinkrail`), and `thinkrail --help` lists the rest.

### Requirements

You need `git` on your `PATH` and a model provider — sign in with [JetBrains AI](https://www.jetbrains.com/ai/) right from
the app, or bring your own provider credentials. App state lives under `~/.thinkrail`.

### Platform notes

| Platform | Prebuilt | Signing |
| --- | --- | --- |
| macOS Apple Silicon | Yes | Notarized DMG, signed CLI |
| macOS Intel | No, [build from source](CONTRIBUTING.md#development-setup) | — |
| Linux arm64 / x64 | Yes | Unsigned |
| Windows x64 | Yes | CLI and desktop installer signed |

See [CONTRIBUTING.md](CONTRIBUTING.md#artifact-signing) for the signing pipeline.

## Analytics & privacy

ThinkRail sends basic usage events to [PostHog EU](https://posthog.com): launches, chat creation, message
sends, and provider connections. These are always on and carry a random installation ID, which links events
from one installation over time; no person profile is created.

The sharing switch at first launch and in **Settings → Privacy** controls only additional statistics; turning
it off does not stop the basic events. Neither tier sends prompts, code, transcripts, file or repository
names, or credentials. The [analytics spec](packages/server/src/analytics/SPEC.md) defines the exact event
boundaries.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup and architecture, plus
[`goal-and-requirements.md`](goal-and-requirements.md) and [`architecture.md`](architecture.md) for the
canonical product and design specs. This project and community are governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).
