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

The V1 entrypoint: the `thinkrail-pi` bin. Boots the engine host in-process and opens the browser UI at
its URL. It is a thin launcher — all engine logic lives in `packages/server`.

## Flow

1. Parse argv + env into options (`src/args.ts`, a pure function); `--help` prints usage and exits.
2. `resolveShellEnv()` first (a GUI- or `npx`-launched process must still find `pi`/`git` on PATH); it
   runs once, before any `AgentSession` (sessions are created lazily, on a WS request).
3. Resolve the static dir (`THINKRAIL_PI_STATIC_DIR`, else the built web app shipped beside the bin) and
   warn if it's missing.
4. Resolve a free listen port at or above the requested one (`findFreePort` — `Bun.serve` won't report a
   busy port), then `createServer({ port, host, staticDir, projectPath? })` to embed the host in this Bun
   process.
5. Resolve the actual port, log the URL, then open the browser at it (cross-platform: `open` / `start` /
   `xdg-open`, best-effort), unless `--no-open`.
6. SIGINT / SIGTERM → `server.stop()` (disposes agent sessions + PTYs, closes the socket), then exit.

## Interface

`bin` = `./src/index.ts` (bun runs the TS source directly). Args: `--port` (stable default 24242,
scans upward to the next free port on collision), `--host` (default `localhost`), `--no-open`, `-h`/`--help`, and one positional
`project-dir` (a git repo to open as a project on boot, best-effort). Env defaults:
`THINKRAIL_PI_PORT` / `THINKRAIL_PI_HOST` / `THINKRAIL_PI_STATIC_DIR` (flag > env > default).

## Single-file binary (`build:binary`)

`bun run build:binary` produces a **standalone `thinkrail-pi` executable** — one self-contained file per
platform — via `bun build --compile`. Bun bundles the host *and* transparently embeds the `bun-pty` native
lib; the only extra step is the **web UI** (a directory the host normally serves), which gets embedded too:

- `scripts/build-binary.ts` enumerates `apps/web/dist`, writes a **transient** `src/web-assets.generated.ts`
  (a Bun file-attribute import per asset + a `{ route, data }[]` manifest + a content-hash version), runs
  `bun build --compile --target=<host|--target>` on `src/compiled-entry.ts`, then deletes the generated file
  (so the working tree + `tsc` stay clean). `src/web-assets.generated.d.ts` is the committed type contract
  `tsc` resolves against when the `.ts` is absent.
- `src/compiled-entry.ts` is the binary's entry: on startup it stages the embedded web files to a per-build
  cache dir (`$XDG_CACHE_HOME`/`~/.cache`/temp, idempotent), sets `THINKRAIL_PI_STATIC_DIR`, then hands off
  to `index.ts`. (`bun-pty` self-extracts automatically; **no photon wasm** — the agent's read tool is set
  to send images raw, server-side.)
- Cross-compile with `--target=bun-darwin-arm64|bun-linux-x64|bun-windows-x64|…`; each bundles that
  platform's matching `bun-pty` lib. The binary is platform-specific and self-extracts a few MB on first run.

## Boundary

- **Owns:** `src/args.ts` (pure `parseArgs(argv, env) → CliOptions` + `USAGE`), `src/index.ts` (the
  run-from-source `bootstrap()`: shell env → server → browser open → signal handlers), and the binary build
  (`scripts/build-binary.ts`, `src/compiled-entry.ts`, `src/web-assets.generated.*`).
- **Allowed deps:** `@thinkrail-pi/server` (`createServer`), `@thinkrail-pi/shared/shellEnv`
  (`resolveShellEnv`), Bun/Node.
- **Forbidden:** reaching into the server's internals (use only its public surface), the browser/`contracts`
  UI layer, `@earendil-works/pi-coding-agent` directly.

## Get right

- A stable default port is friendlier than `port:0` for a CLI you re-run, but you must know the resolved
  port to open the URL — so scan upward from the requested port to the first free one, then open the
  resolved origin. (`Bun.serve` won't surface `EADDRINUSE` for a busy port, so the free port is found by
  probing, not by catching a bind error — see `@thinkrail-pi/shared/freePort`.)
- The browser is the V1 client, not a fallback — the same UI can point at a remote host (the V2 path).
- The agent runs in this process — a fatal fault takes the app down (the accepted in-process tradeoff).
- `resolveShellEnv()` runs once, before any `AgentSession`.

## Later

A headless `serve` mode (always-on host for remote/automations, V2). `apps/desktop` is the sibling
launcher that swaps "open a browser" for "open a native webview" over the same `createServer()`.
