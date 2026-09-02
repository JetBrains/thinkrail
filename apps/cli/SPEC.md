---
id: module-cli
type: module-design
status: active
title: CLI host launcher
parent: architecture
depends-on: [module-server, module-shared]
tags: [v1, host]
---

## Responsibility

The retained browser launcher and standalone rollback artifact: the `thinkrail` bin. It boots the engine
host in-process and opens the browser UI at its URL. It is a thin sibling of `apps/desktop`; all engine
and process-boot logic lives in `packages/server`.

## Flow

1. Parse argv + env into options (`src/args.ts`, a pure function); `--help` prints usage and exits.
2. Resolve the static dir (`THINKRAIL_STATIC_DIR`, else the built web app shipped beside the bin) and
   warn if it is missing.
3. Await `bootHost({ portMode: "free", … })`. The shared boot path installs crash logging, repairs the
   login-shell environment, initializes the current PI runtime/Central watcher, resolves a free serving
   port at or above the requested one, and embeds the host in this Bun process. Another CLI or desktop
   host using the same data directory does not block startup; each process serves its own endpoint.
4. On interactive stdout render the shared recursive ThinkRail startup mark with honest `host ready`
   status + the resolved endpoint, retain the parse-stable `thinkrail → <url>` line, and open the browser
   there (cross-platform: `open` / `start` / `xdg-open`, best-effort), unless `--no-open`. Exit-only
   commands and redirected output omit the mark.
5. SIGINT / SIGTERM await the shared idempotent `server.shutdown()` before exit; they do not duplicate
   agent, analytics, or resource teardown.

## Interface

`bin` = `./src/index.ts` (bun runs the TS source directly). A leading `update` or `uninstall` positional
is a **subcommand** (`thinkrail update [--channel stable|nightly] [--version X.Y.Z]`,
`thinkrail uninstall [--remove-data|--keep-data] [-y]`) intercepted before the launch flags — see
*Self-update* / *Uninstall* below. The set lives in `args.ts` (`parseSubcommand`) because the compiled
entry needs it too: a subcommand never boots the host, so it must not pay for (or, in `uninstall`'s case,
re-create) the staged asset cache. Otherwise the launch args: `--port` (stable default 24242,
scans upward to the next free port on collision), `--host` (default `localhost`), `--no-open`,
`--no-analytics` (**per-run mute** for anonymous usage analytics — this run sends nothing; the
durable switch is the app's Settings → Privacy toggle, see `submodule-server-analytics`),
`--verbose` (debug-level logging — threaded to `bootHost` as `verbose: true`; the log files under
`<dataDir>/logs` and their env switch `THINKRAIL_LOG_LEVEL` belong to `submodule-server-log`, whose
module is that variable's single reader — same pattern as `THINKRAIL_NO_ANALYTICS`, so `dev.ts` honors
it too),
`-v`/`--version` (print the baked version and exit), `-h`/`--help`, and one positional `project-dir` (a
git repo to open as a project on boot, best-effort). Env defaults: `THINKRAIL_PORT` / `THINKRAIL_HOST` /
`THINKRAIL_STATIC_DIR` (flag > env > default). `THINKRAIL_NO_ANALYTICS` is documented in `--help` but
deliberately **not** parsed here — the host's analytics module is its single reader (see below).

## Self-update (`thinkrail update`)

`src/update.ts` ports the old repo's `thinkrail upgrade` (renamed): it re-invokes the **published
installer** for the binary's channel — `install.sh` on macOS/Linux, `install.ps1` on Windows — so the
installer stays the single source of the download → checksum → replace → PATH logic. Channel/prefix
resolve the same way on both: flag > `~/.config/thinkrail/install.json` > baked channel (from
`version.ts`; `dev` → `stable`) / `~/.local`.

- **Unix:** `curl` the script, feed it to `bash -s -- --channel … --prefix … [--version …]`.
- **Windows:** fetch `install.ps1`, write it to a temp `.ps1`, and run it through the first available
  PowerShell host (`powershell.exe`, else `pwsh.exe`) as
  `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <tmp> -Channel … -Version … -Prefix …`.
  `-File` (not `irm | iex`, which needs a shell to pipe through, and not `-Command`, whose quoting is a
  minefield) hands the installer's own params through argv. All three params are passed **always**,
  including `-Version latest`: install.ps1's params *default from the `THINKRAIL_*` env vars*, which the
  child would inherit, so being explicit is what makes an update deterministic for a user who has one
  set. Replacing the *running* exe works because install.ps1's `Install-ThinkRailBinary` renames a locked
  `thinkrail.exe` aside to `thinkrail.exe.<rand>.old` (Windows refuses to *delete* a running image but
  permits *renaming* it) and drops the fresh one in; the next install sweeps the leftover.

Any Windows failure (fetch, no PowerShell host, installer non-zero) falls back to *printing* the manual
per-shell command (`windowsManualUpdateMessage`) with the releases page under it: cmd's `set "X=v" &&`
and PowerShell's `$env:X='v';` are not interchangeable — one shell's syntax shown to the other silently
re-installs the wrong build, and a dropped `THINKRAIL_PREFIX` would put a second copy under `.local`
while the PATH-resolved exe stays stale. `resolveWindowsPrefix` owns that seam for the message (it omits
the installer's own default as noise); `resolveWindowsInstallPrefix` is the same validation for the
executed plan, and both refuse a metadata prefix that isn't a rooted Windows path or can't be safely
quoted (Windows needs its own charset — `PREFIX_FORBIDDEN_RE` rejects the backslash every Windows path is
made of). The arg parse + channel/prefix resolution are pure (`parseUpdateArgs` / `resolveUpdateChannel` /
`resolveWindowsPrefix` / `resolveUpdatePlan` / `resolveWindowsUpdatePlan`, unit-tested); only fetch
(`curl` / `fetch`) + run (`bash -s` / `powershell -File`) touch IO.
`THINKRAIL_INSTALL_SCRIPT_URL` / `THINKRAIL_INSTALL_PS1_URL` override the installer URLs (testing /
forks). See `module-ci-release` for the installers themselves.

## Uninstall (`thinkrail uninstall`)

`src/uninstall.ts` is the inverse of the installers, and only of them: it removes **the executable, the
PATH edit the installer made, `install.json`, and the binary's staging cache** — then *asks* about the
user's app state (the data dir), which is **kept by default** because it holds the workspace git
worktrees and any uncommitted work in them. pi's own state (`~/.pi`) is never touched: it is not ours.

- **Plan, then confirm, then act.** `resolveUninstallTargets` is pure (platform + home + install
  metadata + `process.execPath` → the paths); an inspection pass narrows it to what actually exists (and
  which rc files really carry the installer's block) so the printed plan is *true*; then the prompts;
  then the removals, each reported as `removed` / `kept` / `not found` / `failed` (any `failed` → exit 1).
- **Prompts** (`node:readline/promises`): the data-dir question (default *keep*), then a final confirm.
  `-y`/`--yes` skips both and `--keep-data`/`--remove-data` answers the first one non-interactively; with
  no TTY and no `--yes` the command refuses rather than guessing.
- **Which executables:** `<prefix>/bin/thinkrail[.exe]` from the install metadata (else the installers'
  `~/.local` default) **plus `process.execPath` when it is itself a `thinkrail` binary** — that covers a
  custom prefix whose `install.json` is gone. Nothing else is ever deleted, whatever the metadata says.
- **The PATH edit, per platform seam:** on Unix the installer's block is *self-identifying*
  (`# >>> thinkrail PATH >>>` … `# <<< thinkrail PATH <<<`), so `stripRcPathBlock` removes it from every
  candidate rc file that carries it (bash/zsh/`$ZDOTDIR`/`.profile`, and the fish `conf.d` file is
  deleted when nothing but the block was in it) — and refuses to touch a file whose block has no end
  marker rather than truncating it. On Windows the registry entry is *opaque* (nothing marks it as ours),
  so install.ps1 **records whether it added the entry** (`install.json`'s `path_entry_added`, sticky across
  re-installs of the same prefix — an update sees `already` precisely because an earlier run of ours added
  it) and the uninstaller removes it **only for that flag, and only for the prefix it was recorded
  against**. Being installed is not the same as having added the entry: `-NoModifyPath`, an entry that was
  already present, a failed registry write and a Git-Bash `install.sh` install all record an install
  without touching the Windows PATH, and legacy metadata predates the flag — all of those are *not ours*,
  so the PATH is left alone and the user is told which dir to check. The edit itself runs as an embedded PowerShell script —
  the exact inverse of install.ps1's `Add-ThinkRailToUserPath` (same `HKCU\Environment` handling,
  preserving the value's `REG_EXPAND_SZ` kind, comparing entries raw *and* `%VAR%`-expanded, then
  broadcasting `WM_SETTINGCHANGE`) — because round-tripping a raw PATH value through a pipe would risk
  mangling non-ASCII entries in the console code page.
- **Deleting the running program:** Unix unlinks a running binary happily. Windows cannot, so the exe is
  renamed to the same `thinkrail.exe.<rand>.old` name install.ps1's cleanup already recognizes, and a
  detached PowerShell retries the delete for a few seconds after we exit; the report says which happened.
  Stale `.old`/`.new` leftovers in the bin dir are swept too.
- `src/powershell.ts` is the shared seam for both Windows paths (find a host, run a script text through
  it, `psQuote` a value into a single-quoted literal). `src/paths.ts` owns the *installed* layout —
  `install.json` (read by `update` + `uninstall`) and the staging cache root (written by
  `compiled-entry`, deleted by `uninstall`) — so those three agree by construction.

## Version stamping (release seam)

`@thinkrail/shared/version` exports `{ version, channel, commit }` with a permanent from-source default
(`0.0.0-dev`). The release pipeline overwrites that one module in the throwaway CI checkout before
building CLI and desktop, so both report identical identity. There is no analytics-key seam here.
`bootstrap.ts` prints the shared version for `--version`, passes it into `bootHost` for
`server.welcome.appVersion`, and threads `{ channel, build: "binary" | "source", mute }` into analytics.

## Launch entries + build provenance

`src/bootstrap.ts` owns the launch sequence (argv → subcommand or host boot → open browser) and exports
`launch(build: BuildKind)`, which carries the single error-exit path. The two entries differ *only* in the
provenance they declare, and each knows its own by construction rather than by inspecting the runtime:

- `src/index.ts` — the `bin`, i.e. run **from source**: `launch("source")`.
- `src/compiled-entry.ts` — the **compiled binary**'s entry (staging + pi registrations first):
  `launch("binary")`.

`build` rides analytics as a plain property, so `channel = dev` runs are still separable into a locally
compiled binary vs a source run (see `submodule-server-analytics`). Deliberately *not* sniffed from Bun's
`/$bunfs/` module paths: that's an implementation detail a Bun bump can change, and it would mislabel
silently. `src/args.ts` parses `--no-analytics` into `CliOptions.noAnalytics` but does **not** read
`THINKRAIL_NO_ANALYTICS` — the host's analytics module is that variable's single reader, so every
entrypoint honors it (including `packages/server/src/dev.ts`, which parses no argv).

## Single-file binary (`build:binary`)

`bun run build:binary` produces a **standalone `thinkrail` executable** — one self-contained file per
platform — via `bun build --compile`. Bun bundles the host *and* transparently embeds the `bun-pty` native
lib; the extra steps are the **web UI** (a directory the host normally serves), the **bundled pi
extensions** (which the server path-loads out of `node_modules` in dev — impossible inside a binary),
and `trash`'s **native helper sidecars** (which macOS/Windows must execute from real filesystem paths):

- `scripts/build-binary.ts` consumes `@thinkrail/server/build-support`, writes three **transient** generated modules, runs
  `bun build --compile --no-compile-autoload-bunfig --target=<host|--target>` on
  `src/compiled-entry.ts`, then deletes them (so the artifact cannot execute a project-local
  `bunfig.toml` preload before ThinkRail boots, and the working tree + `tsc` stay clean); each generated
  module has a committed `.d.ts` type contract `tsc` resolves against
  when the `.ts` is absent:
  - `src/web-assets.generated.ts` — enumerates `apps/web/dist`: a Bun file-attribute import per asset +
    a `{ route, data }[]` manifest + a content-hash version.
  - `src/bundled-extensions.generated.ts` — **value-imports the five bundled extension entries**
    (`pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-thinkrail-workflow`, `pi-todos`), resolved from the
    *server package's* module context (absolute paths — they aren't deps of `cli`), so Bun compiles the
    raw `.ts` and their real deps (`yaml`, `linkedom`, `unpdf`, …) into the binary; plus the
    `pi-spec-graph`/`pi-thinkrail-workflow`/`pi-todos` `skills/` files embedded like web assets (matching what dev
    wires via `additionalSkillPaths` — parity, not a superset). Its `.d.ts` types the factories via the
    server's exported `BundledExtensionFactory`, so `cli` still never imports
    `@earendil-works/pi-coding-agent`.
  - `src/runtime-assets.generated.ts` — embeds `trash`'s `macos-trash` and `windows-trash.exe` helper
    binaries, resolved from the server package's dependency context, as a content-hashed manifest.
- `src/compiled-entry.ts` is the binary's entry: on startup it stages the embedded web + skills +
  runtime-helper files to per-build cache dirs (`$XDG_CACHE_HOME`/`~/.cache`/temp; files written straight into the versioned dir,
  then a sibling `<dir>.complete` marker written **last** — readiness is gated on the marker, so a killed
  first run leaves an incomplete cache that's re-extracted next launch. **No stage-then-rename**: Bun's
  `renameSync` of a fresh non-empty dir `EPERM`s on Windows, so the marker replaces the directory-rename
  publish), makes the macOS helper executable, sets `THINKRAIL_STATIC_DIR`, then **awaits** the server's
  **`registerBundledRuntime`** seam — which injects the factories + staged skills dir + real trash-helper
  paths **and** performs pi's binary-only registrations (the
  statically-bundled OAuth flows + the Bedrock provider module, replacing pi's binary-hostile dynamic
  imports — see the server agent SPEC) — then hands off to `index.ts`. (`bun-pty` self-extracts
  automatically; **no photon wasm** — the agent's read tool is set to send images raw, server-side.
  Skills must be staged to the *real* filesystem: pi reads `SKILL.md` via plain fs and embeds the path in
  the system prompt.)
- Cross-compile with `--target=bun-darwin-arm64|bun-linux-x64|bun-windows-x64|…`; each bundles that
  platform's matching `bun-pty` lib. The binary is platform-specific and self-extracts a few MB on first run.
- **Verify by booting the artifact** (not just building it): extension wiring regressions surface only at
  runtime — e.g. path-loading broke silently for every extension added after the binary build first landed.
  `scripts/smoke-binary.ts` (root: `bun run smoke:binary`, after `build:binary`) boots the built binary
  against throwaway data/agent/cache dirs. Its CLI adapter runs the shared
  `@thinkrail/server/artifact-probes` host assertions also used by desktop; CLI-only assertions additionally
  prove the staged-cache and command-line shape. Together they assert: a project-local `bunfig.toml` preload does **not**
  execute, `/health` answers, `/` serves the staged UI, the bundled skills staged to the cache dir,
  **an external synthetic PI extension loads by absolute path** through the compiled artifact's public PI
  loader with no `pi` executable on `PATH`, under both the default and a custom `PI_CODING_AGENT_DIR`
  (test-owned source only; no Central-generated artifact is committed, copied, read, or snapshotted),
  **an OAuth sign-in reaches its auth URL** (a WS
  `provider.loginStart` for the Codex provider must answer the method select and push an `authUrl`
  frame — offline and credential-free, since pi's flow only does PKCE + a local callback server before
  notifying the URL; this pins the statically-registered OAuth flows, which can only break inside the
  artifact — the frames are hand-rolled JSON, keeping `contracts` out of the cli), **moves a seeded pi
  transcript through `session.delete` into the OS trash** (pinning the static `processMountinfo` parser
  inclusion that `trash`'s Linux implementation otherwise reaches through a binary-opaque CommonJS
  require; the fixture is seeded at the **host-reported `worktreePath`**, never the smoke's own temp path,
  because the host stores git's symlink-resolved root — macOS `/var` → `/private/var`, Windows' 8.3 `TEMP`
  — so a fixture written at an unresolved path lands in an encoded session dir the host never scans, and
  the delete then truthfully no-ops while the file stays put), creates an offline session so every bundled
  factory is evaluated, verifies both macOS/Windows helpers were staged from the artifact, and SIGTERM
  exits 0. CI builds + smokes the binary on every PR on **ubuntu and windows** (each its host target), with
  `e2e:binary` on ubuntu; macOS binary coverage stays release-matrix-only. The Windows leg is not optional
  polish: the host reaches that extension only when its Central inspection says *installed and supported*,
  so the whole assertion is Windows-executable-shaped, and an ubuntu-only smoke let #255 ship a release
  matrix that failed for two days while publishing nothing (see `module-ci-release`). It does not prompt a
  provider; real turn behavior stays in `e2e:agent`. The smoke's **broad-net sibling** is `bun run e2e:binary` (root
  `playwright.binary.config.ts`): the whole no-agent e2e suite executed against this binary — also in CI
  on every PR. And `bun run check:seams` (root `scripts/check-binary-seams.ts`) is the build-time canary
  for the seam class: it fails when a pi bump introduces a new bundler-opaque dynamic import the server's
  `registerBundledRuntime` doesn't statically register. The scan **excludes `pi-coding-agent/dist/bundle/`**
  (recorded as a skipped dir in the script, stale-checked like the allowlist): pi ≥ 0.84.3 ships a bundled
  runtime there for its own CLI `bin` and `./rpc-entry` export — the only two ways to reach it — while the
  in-process library import (`.` → `dist/index.js`) stays on the modular runtime, so the bundle's opaque
  imports (content-hashed chunk duplicates of the allowlisted modular seams) are dead code in ThinkRail and
  allowlisting them by chunk name would churn on every pi release.
- **The smoke's fixtures are host-OS-shaped, not POSIX-shaped.** Every one of them was a Windows failure
  in a green-on-Linux suite:
  - The **fake Central CLI is compiled** (`bun build --compile` into `central`/`central.exe`), not written
    as a `#!/bin/sh` script: the host only feeds the synthetic extension to PI when `inspectJbcentral`
    resolves *and spawns* a `central` reporting a supported version, and Windows can neither resolve an
    extensionless file as an executable nor `CreateProcess` a shell script. A `.cmd` shim was rejected —
    `Bun.spawn` cannot launch a batch file without a `cmd.exe` wrapper, and it splits the fixture per shell
    dialect. Its argv surface stays the reviewed one: `--version` prints a synthetic `central <semver>`,
    everything else exits non-zero (so the background `status` probe stays an `unknown` observation).
  - The **pi-free `PATH` is derived from the live `PATH`** by dropping the entries that hold a `pi`
    executable, then prepending the fake bin dir — never a hardcoded `/usr/bin:/bin` skeleton, which on
    Windows leaves the host without `git.exe` or System32 (`project.open` shells out to bare `git`). The
    smoke still asserts no `pi` is reachable, and additionally that `git` survived the filter.
  - **`HOME` *and* `USERPROFILE` point at the smoke's temp home** in every spawned host, because
    `homedir()` — which pi's `getAgentDir()` uses — reads `USERPROFILE` on Windows and ignores `HOME`.
    Without it the default-agent-dir probe writes into the runner's (or a Windows developer's) real
    `%USERPROFILE%\.pi\agent` instead of the sandbox.
  - **Every spawned host's env is built by `hostEnv`, which drops the inherited case-variants of the keys
    it overrides.** Windows env names are case-insensitive and the runner's is spelled `Path`, so the
    familiar `{...process.env, PATH: x}` ships *both* keys and the child reads the inherited one — the host
    then ran with the machine's real PATH, saw no fake `central`, reported `absent`, and never loaded the
    extension while the fixture itself was provably fine.
  - **Both legs require `provider.status`'s `jbcentral` to be `configured`**, not just the model to be
    present: the artifact sits inside the *default* agent dir, so a leg that only checks `model.list` could
    in principle pass through pi's own agent-dir discovery instead of the Central-fed absolute path this
    gate exists to pin. The status read waits out a transient `configuring` (a boot-time watcher event).
  - **The two hosts run one at a time**: the default-agent probe boots, asserts and exits before the
    custom-agent host is spawned. They load the *same* on-disk extension, and a concurrent initial load
    races on the loader's transpile cache — harmless on POSIX, an EPERM-class failure on Windows, where the
    loser silently falls back to a runtime without the extension (`prepareInitialRuntime`'s plain-runtime
    path). A failed *rebuild* keeps the loaded generation, so only the boot load can lose the provider this
    way — which is why the assertion reports `provider.status`'s `jbcentral` state on failure: `load-failed`
    names that cause, `absent` names a fixture that never ran.

## Boundary

- **Owns:** `src/args.ts` (pure `parseArgs(argv, env) → CliOptions` + `parseSubcommand` + `USAGE`),
  `src/index.ts` (the run-from-source `bootstrap()`: shell env → server → browser open → signal handlers),
  and the binary build + its boot smoke (`scripts/build-binary.ts`, `scripts/smoke-binary.ts`,
  `scripts/artifactName.ts` — the one place the artifact filename rule lives, including the `.exe` Bun
  appends for a Windows target, so the build's output path and the smoke's default input cannot disagree
  the way they did on Windows; the release action re-derives the same name in bash because it is also the
  published-asset contract, see `module-ci-release`),
  `src/compiled-entry.ts`, `src/web-assets.generated.*`, `src/bundled-extensions.generated.*`,
  `src/runtime-assets.generated.*`),
  `src/update.ts` (the `update`
  subcommand), `src/uninstall.ts` (the `uninstall` subcommand), `src/paths.ts` (the installed layout:
  `install.json` + the staging cache root), and `src/powershell.ts` (the Windows PowerShell seam). Central
  integration remains a server/auth feature; the launcher has no Central subcommand or protocol implementation.
- **Allowed deps:** `@thinkrail/server` (`bootHost`, `registerBundledRuntime`, build-support and artifact-probe subpaths, `dataDir` — the
  uninstaller has to name the app state dir, and must name the *same* one the host uses — plus the
  test-only `history-test-fixtures` subpath in the artifact smoke to seed a real pi transcript),
  `@thinkrail/shared/startupMark` (the shared boot
  signature renderer) + `@thinkrail/shared/version` (the shared release identity), Bun/Node; the generated build module may
  value-import the bundled extension packages' entries (resolved via the server package — build-time
  only, deleted after compile).
- **Forbidden:** product feature/domain logic; reaching into the server's internals (use only its public
  surface); importing the web, desktop, or `contracts` UI layers; `@earendil-works/pi-coding-agent`
  directly. An ordinary product feature must not need a CLI implementation.

## Get right

- A stable default port is friendlier than `port:0` for a CLI you re-run, but you must know the resolved
  port to open the URL — so scan upward from the requested port to the first free one, then open the
  resolved origin. (`Bun.serve` won't surface `EADDRINUSE` for a busy port, so the free port is found by
  probing, not by catching a bind error — see `@thinkrail/shared/freePort`.)
- The browser is the V1 client, not a fallback — the same UI can point at a remote host (the V2 path).
- The agent runs in this process — a fatal fault takes the app down (the accepted in-process tradeoff).
- `resolveShellEnv()` runs once, before any `AgentSession`.
- The startup mark is a presentation of the resolved launch result, never a second readiness signal:
  `bootHost` must return first, and the parse-stable `thinkrail → <url>` line remains unchanged beneath it.

## Later

A headless `serve` mode (always-on host for remote/automations, V2). The shipped desktop sibling swaps
"open a browser" for "open a native webview" over the same `bootHost()` lifecycle.
