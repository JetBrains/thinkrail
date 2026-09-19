# ThinkRail

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

Open a git repo as a project, spin up workspaces as Git worktrees — each its own branch and cwd —
and work across a tabbed Monaco editor, terminals, a spec-graph viewer, and multiple
concurrent AI chat sessions, all scoped to the active worktree.

ThinkRail is a desktop-and-mobile client for the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent: a thin host that runs `pi` in-process and bridges it to a rich, mobile-first UI. `pi` owns
models, skills, compaction, cost, and session state; the app owns the workspace, the editor, and the wire.

**Website:** [thinkrail.ai](https://thinkrail.ai/)

## Install

### Desktop app

On Linux, first install Ubuntu 24.04+ (glibc 2.38) and GTK 3 / WebKitGTK 4.1:
`sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2`.

Download the `thinkrail-desktop-*` asset for your platform from the
[releases page](https://github.com/JetBrains/thinkrail/releases) and run it: a DMG for macOS Apple
Silicon, a setup ZIP for Windows x64, or a setup tarball for Linux x64/ARM64. This is the full native window,
with background auto-updates.

### Command line

The `thinkrail` CLI is a single self-contained binary that opens the same app in your browser.

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

To pin a version or follow the nightly channel, the installer takes `--channel nightly` and
`--version 0.2.0` (on Windows, the `THINKRAIL_CHANNEL` and `THINKRAIL_VERSION` environment variables).

### Either way

You need `git` on your `PATH` and an authenticated `pi` provider — sign in with [JetBrains AI](https://www.jetbrains.com/ai/) right from
the app, or bring your own provider credentials. App state lives under `~/.thinkrail`.

`thinkrail update` upgrades in place, `thinkrail uninstall` removes it,
and `thinkrail --help` lists the rest.

### Platform notes

Prebuilt for macOS (Apple Silicon), Linux arm64 + x64, and Windows x64. Intel macOS isn't prebuilt — [build from source](CONTRIBUTING.md#development-setup).

The Windows CLI and desktop installer are signed. macOS and Linux artifacts are not yet notarized or
signed, so Gatekeeper may block a downloaded DMG.

## Analytics & privacy

ThinkRail reports anonymous usage counts to [PostHog EU](https://posthog.com) and asks at first launch
before sending anything more. It never sends prompts, code, transcripts, file or repository names, or
credentials. Change your choice in **Settings → Privacy**, or see the
[analytics spec](packages/server/src/analytics/SPEC.md) for the exact event boundaries.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup, architecture,
and the spec-first workflow, plus [`goal-and-requirements.md`](goal-and-requirements.md) and
[`architecture.md`](architecture.md) for the canonical product and design specs. This project and
community are governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
