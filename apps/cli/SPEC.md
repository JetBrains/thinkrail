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

The V1 entrypoint: the `thinkrail` bin. Boots the engine host in-process and opens the browser UI at
its URL. It is a thin launcher — all engine logic lives in `packages/server`.

## Flow

1. Parse argv + env into options (`src/args.ts`, a pure function); `--help` prints usage and exits.
2. `resolveShellEnv()` first (a GUI- or `npx`-launched process must still find `pi`/`git` on PATH); it
   runs once, before any `AgentSession` (sessions are created lazily, on a WS request).
3. Resolve the static dir (`THINKRAIL_STATIC_DIR`, else the built web app shipped beside the bin) and
   warn if it's missing.
4. Resolve a free listen port at or above the requested one (`findFreePort` — `Bun.serve` won't report a
   busy port), then `createServer({ port, host, staticDir, projectPath? })` to embed the host in this Bun
   process.
5. Resolve the actual port, log the URL, then open the browser at it (cross-platform: `open` / `start` /
   `xdg-open`, best-effort), unless `--no-open`.
6. SIGINT / SIGTERM → `server.stop()` (disposes agent sessions + PTYs, closes the socket), then exit.

## Interface

`bin` = `./src/index.ts` (bun runs the TS source directly). A leading `update` positional is a
**subcommand** (`thinkrail update [--channel stable|nightly] [--version X.Y.Z]`) intercepted before the
launch flags — see *Self-update* below. Otherwise the launch args: `--port` (stable default 24242,
scans upward to the next free port on collision), `--host` (default `localhost`), `--no-open`,
`-v`/`--version` (print the baked version and exit), `-h`/`--help`, and one positional `project-dir` (a
git repo to open as a project on boot, best-effort). Env defaults: `THINKRAIL_PORT` / `THINKRAIL_HOST` /
`THINKRAIL_STATIC_DIR` (flag > env > default).

## Self-update (`thinkrail update`)

`src/update.ts` ports the old repo's `thinkrail upgrade` (renamed): it re-invokes the published
`install.sh` for the binary's channel, so the installer stays the single source of the download →
checksum → replace → PATH logic. Channel/prefix resolve as flag > `~/.config/thinkrail/install.json` >
baked channel (from `version.ts`; `dev` → `stable`) / `~/.local`. Unix-only (replacing a running `.exe`
in place isn't possible on Windows → points to the releases page). The arg parse + channel/prefix
resolution are pure (`parseUpdateArgs` / `resolveUpdatePlan`, unit-tested); only fetch (`curl`) + run
(`bash -s`) touch IO. `THINKRAIL_INSTALL_SCRIPT_URL` overrides the installer URL (testing / forks). See
`module-ci-release` for the installer itself.

## Version stamping (release seam)

`src/version.ts` exports `{ version, channel, commit }` with a from-source default (`0.0.0-dev`). Unlike
the transient `*.generated.ts`, it's a **permanent committed module** so `--version` + `tsc` work from
source. The release pipeline (`module-ci-release`) overwrites it in the throwaway CI checkout before
`build:binary`, baking the real release identity into the binary. `index.ts` reads it, prints it for
`--version`, and passes `appVersion` into `bootHost` — so the host echoes it in `server.welcome`
(`ServerWelcome.appVersion`), letting a client report host version alongside the protocol-drift check.

## Single-file binary (`build:binary`)

`bun run build:binary` produces a **standalone `thinkrail` executable** — one self-contained file per
platform — via `bun build --compile`. Bun bundles the host *and* transparently embeds the `bun-pty` native
lib; the extra steps are the **web UI** (a directory the host normally serves) and the **bundled pi
extensions** (which the server path-loads out of `node_modules` in dev — impossible inside a binary):

- `scripts/build-binary.ts` writes two **transient** generated modules, runs
  `bun build --compile --target=<host|--target>` on `src/compiled-entry.ts`, then deletes them (so the
  working tree + `tsc` stay clean); each has a committed `.d.ts` type contract `tsc` resolves against
  when the `.ts` is absent:
  - `src/web-assets.generated.ts` — enumerates `apps/web/dist`: a Bun file-attribute import per asset +
    a `{ route, data }[]` manifest + a content-hash version.
  - `src/bundled-extensions.generated.ts` — **value-imports the four bundled extension entries**
    (`pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-thinkrail-workflow`), resolved from the
    *server package's* module context (absolute paths — they aren't deps of `cli`), so Bun compiles the
    raw `.ts` and their real deps (`yaml`, `linkedom`, `unpdf`, …) into the binary; plus the
    `pi-spec-graph`/`pi-thinkrail-workflow` `skills/` files embedded like web assets (matching what dev
    wires via `additionalSkillPaths` — parity, not a superset). Its `.d.ts` types the factories via the
    server's exported `BundledExtensionFactory`, so `cli` still never imports
    `@earendil-works/pi-coding-agent`.
- `src/compiled-entry.ts` is the binary's entry: on startup it stages the embedded web + skills files to
  per-build cache dirs (`$XDG_CACHE_HOME`/`~/.cache`/temp; files written straight into the versioned dir,
  then a sibling `<dir>.complete` marker written **last** — readiness is gated on the marker, so a killed
  first run leaves an incomplete cache that's re-extracted next launch. **No stage-then-rename**: Bun's
  `renameSync` of a fresh non-empty dir `EPERM`s on Windows, so the marker replaces the directory-rename
  publish), sets `THINKRAIL_STATIC_DIR`, registers the factories + staged skills dir via
  the server's **`setBundledExtensions`** seam, then hands off to `index.ts`. (`bun-pty` self-extracts
  automatically; **no photon wasm** — the agent's read tool is set to send images raw, server-side.
  Skills must be staged to the *real* filesystem: pi reads `SKILL.md` via plain fs and embeds the path in
  the system prompt.)
- Cross-compile with `--target=bun-darwin-arm64|bun-linux-x64|bun-windows-x64|…`; each bundles that
  platform's matching `bun-pty` lib. The binary is platform-specific and self-extracts a few MB on first run.
- **Verify by booting the artifact** (not just building it): extension wiring regressions surface only at
  runtime — e.g. path-loading broke silently for every extension added after the binary build first landed.
  `scripts/smoke-binary.ts` (root: `bun run smoke:binary`, after `build:binary`) boots the built binary
  against throwaway data/agent/cache dirs and asserts: `/health` answers, `/` serves the staged UI, the
  bundled skills staged to the cache dir, and SIGTERM exits 0. CI builds + smokes the binary on every PR
  (its host target — the generation/bundling/staging logic is platform-independent). What it can't cover
  without provider auth: the factories registering inside a live session (that's `e2e:agent` territory,
  run-from-source).

## Boundary

- **Owns:** `src/args.ts` (pure `parseArgs(argv, env) → CliOptions` + `USAGE`), `src/index.ts` (the
  run-from-source `bootstrap()`: shell env → server → browser open → signal handlers), and the binary build
  + its boot smoke (`scripts/build-binary.ts`, `scripts/smoke-binary.ts`, `src/compiled-entry.ts`,
  `src/web-assets.generated.*`, `src/bundled-extensions.generated.*`), `src/version.ts` (the release
  version stamped in at build time), `src/update.ts` (the `update` subcommand), and `src/jbcentral.ts` (the
  `jbcentral` subcommand — JetBrains Central CLI proxy wiring).
- **Allowed deps:** `@thinkrail/server` (`createServer`, `setBundledExtensions`),
  `@thinkrail/shared/shellEnv` (`resolveShellEnv`), Bun/Node; the generated build module may
  value-import the bundled extension packages' entries (resolved via the server package — build-time
  only, deleted after compile).
- **Forbidden:** reaching into the server's internals (use only its public surface), the browser/`contracts`
  UI layer, `@earendil-works/pi-coding-agent` directly.

## Get right

- A stable default port is friendlier than `port:0` for a CLI you re-run, but you must know the resolved
  port to open the URL — so scan upward from the requested port to the first free one, then open the
  resolved origin. (`Bun.serve` won't surface `EADDRINUSE` for a busy port, so the free port is found by
  probing, not by catching a bind error — see `@thinkrail/shared/freePort`.)
- The browser is the V1 client, not a fallback — the same UI can point at a remote host (the V2 path).
- The agent runs in this process — a fatal fault takes the app down (the accepted in-process tradeoff).
- `resolveShellEnv()` runs once, before any `AgentSession`.

## Later

A headless `serve` mode (always-on host for remote/automations, V2). `apps/desktop` is the sibling
launcher that swaps "open a browser" for "open a native webview" over the same `createServer()`.
