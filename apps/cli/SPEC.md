---
id: module-cli
type: module-design
status: draft
title: CLI host launcher
parent: architecture
depends-on: [module-server]
tags: [v1, host]
---

## Responsibility

The V1 entrypoint: the `thinkrail-pi` bin. Boots the engine host in-process and opens the browser UI at
its URL. It is a thin launcher — all engine logic lives in `packages/server`.

## Flow

1. `resolveShellEnv()` first (a GUI- or `npx`-launched process must still find `pi` on PATH).
2. `createServer({ port, host, staticDir })` — embed the host in this Bun process.
3. Resolve the actual port, then open the browser at the URL (cross-platform), unless `--no-open`.
4. SIGINT / SIGTERM → graceful `disposeAll()` of agent sessions, then exit.

## Interface

`bin` entry + args: `--port` (stable default with fallback-on-collision), `--host`, `--no-open`,
project dir.

## Get right

- A stable default port is friendlier than `port:0` for a CLI you re-run, but you must know the resolved
  port to open the URL.
- `resolveShellEnv()` runs once, before creating any `AgentSession`.

## Later

A headless `serve` mode (always-on host for remote/automations, V2). `apps/desktop` is the sibling
launcher that swaps "open a browser" for "open a native webview".
