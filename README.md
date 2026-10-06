# ThinkRail

[![JetBrains incubator project](https://jb.gg/badges/incubator-plastic.svg)](https://confluence.jetbrains.com/display/ALL/JetBrains+on+GitHub)

ThinkRail is the agentic IDE that gets better every time you use it — learning your project through
living specs today, and building its own capabilities tomorrow.

We built a rich interface around the [`pi`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
coding agent, isolated work into separate workspaces, and gave the agent durable project knowledge
through living specs and reusable skills. Next, we're adding full extension support, so ThinkRail can
create the tools it needs based on how you actually work.

**Every workspace is a git worktree:** open a git repo as a project, spin up workspaces as `git worktree`s (each its
own branch and cwd), and work across a tabbed Monaco editor, git Changes view, terminals, a read-only
spec-graph viewer, and multiple concurrent `pi` chat sessions — all scoped to the active worktree.

Under the hood, ThinkRail is a thin host that runs `pi` in-process and bridges it to a rich,
mobile-first UI — `pi` owns models, skills, compaction, cost, and session state; the app owns the
workspace, the editor, and the wire.

**Website:** [thinkrail.ai](https://thinkrail.ai/?utm_source=github&utm_medium=readme) — a landing page
that *is* the IDE, its blog, and the
[vibecoder-focused experience](https://thinkrail.ai/vibecoding/?utm_source=github&utm_medium=readme).

## Install

ThinkRail comes as a desktop app and as the `thinkrail` CLI, which serves the same app to your browser.
Both are published with `SHA256SUMS` on the [releases page](https://github.com/JetBrains/thinkrail/releases).

You need `git` on your `PATH` and a model provider: sign in with [JetBrains AI](https://www.jetbrains.com/ai/)
right from the app, or bring your own provider credentials. App state lives under `~/.thinkrail`.

### Desktop app

Download the `thinkrail-desktop-*` asset for your platform:

- **macOS (Apple Silicon):** open the DMG and drag the app into Applications.
- **Windows x64:** extract the whole ZIP, then run its setup executable from the extracted folder
  (`ThinkRail-Setup.exe` for stable, `ThinkRail-Setup-canary.exe` for nightly) — it needs the `.installer`
  folder next to it.
- **Linux x64 / ARM64:** extract the tarball and run `./installer`. You need glibc 2.38+ with GTK 3,
  WebKitGTK 4.1, Ayatana AppIndicator 3, and librsvg 2 — on Ubuntu, that means 24.04 or newer:

  ```bash
  sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
  ```

Stable and nightly desktop builds check for updates in the background and offer them in
**Settings → Updates**; nothing downloads or installs until you choose to. An installation that predates
in-app updates needs one manual reinstall first.

### Command line

The `thinkrail` CLI is a single self-contained binary. The installer downloads the right one, verifies
its checksum, and puts it on your `PATH`.

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```

**Windows** (from PowerShell or cmd)

```powershell
powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
```

Then run `thinkrail`, or open a repo as a project directly:

```bash
thinkrail ~/code/my-repo
```

The installer defaults to the latest stable build. To follow nightly builds or pin a version, pass
options after `bash -s --`:

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --channel nightly
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash -s -- --version X.Y.Z
```

`--version` takes a version from the selected channel: `X.Y.Z` for stable, or `X.Y.Z-nightly.N` together
with `--channel nightly`. `--prefix DIR` changes the install location (default `~/.local`, binary at
`<prefix>/bin/thinkrail`), and `--no-modify-path` leaves your shell profile alone. On Windows, set
`THINKRAIL_CHANNEL`, `THINKRAIL_VERSION`, `THINKRAIL_PREFIX`, or `THINKRAIL_NO_MODIFY_PATH=1` before running
the installer:

```powershell
$env:THINKRAIL_CHANNEL='nightly'; irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex
```

Installed CLI hosts offer **Run Update** in **Settings → Updates**. It runs `thinkrail update`, which
re-runs the installer for your channel; restart `thinkrail` afterwards. `thinkrail uninstall` removes the
binary and its `PATH` entry and asks before deleting `~/.thinkrail` (`--remove-data` deletes it, `-y` skips
the questions). `thinkrail --help` lists everything else.

To install by hand, download a binary and `SHA256SUMS` from the releases page, verify the checksum, and save
the binary as `<prefix>/bin/thinkrail` (`thinkrail.exe` on Windows) so `thinkrail update` can replace it.

### Platform support

| Platform | Prebuilt | Signing |
| --- | --- | --- |
| macOS Apple Silicon | Desktop and CLI | Notarized DMG, signed CLI |
| macOS Intel | No — [build from source](CONTRIBUTING.md#development-setup) | — |
| Linux x64 / ARM64 | Desktop and CLI | Unsigned |
| Windows x64 | Desktop and CLI | Signed CLI and desktop installer |

## Analytics & privacy

ThinkRail sends basic usage events to [PostHog EU](https://posthog.com): installs, launches, chat creation,
message sends, and provider connections. These are always on. They carry a random installation ID, the app
version and channel, your OS and architecture, and coarse provider, model, and sign-in categories. The
installation ID links events from one installation over time; no person profile is created, and GeoIP
enrichment is disabled.

Additional statistics — setup progress, agent-run outcomes, tasks, reviews, and pull-request actions —
follow a sharing switch. The switch is **on by default** and takes effect as soon as the first-launch dialog
opens; turn it off there or later in **Settings → Privacy**. `--no-analytics` or `THINKRAIL_NO_ANALYTICS=1`
suppresses them for a single run. Turning sharing off does not stop the basic events.

With sharing on, a packaged build opens the ThinkRail blog in your browser once. If you accepted marketing
cookies on thinkrail.ai, that visit tells the app which campaign link brought you to the website; the campaign
context expires after 30 days.

Neither tier sends prompts, code, transcripts, file or repository names or paths, credentials, or token and
cost counts. The [analytics spec](packages/server/src/analytics/SPEC.md) defines the exact event boundaries.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development setup and architecture, plus
[`goal-and-requirements.md`](goal-and-requirements.md) and [`architecture.md`](architecture.md) for the
canonical product and design specs. This project and community are governed by the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
