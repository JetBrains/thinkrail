---
id: module-server
type: module-design
status: active
title: Engine host (server library)
parent: architecture
depends-on: [module-contracts, module-shared]
tags: [v1, host]
---

## Responsibility

The engine host as an embeddable library. Serves the browser↔host wire (`Bun.serve` HTTP+WS, static SPA)
and — from M10 — runs the `pi` agent in-process via `createAgentSession`. Launched in-process by
`apps/cli` (and later `apps/desktop`); it has no standalone entrypoint of its own (a `dev.ts` boots it
for development / e2e).

## Boundary

- **Owns:** the HTTP+WS server, static serving, the WS dispatch registry, server-side feature services
  (project/workspace/git/fs/terminal; the `AgentSessionManager` at M10), and `~/.thinkrail-pi` persistence.
- **Public surface:** `createServer(options) → RunningServer` (`{ port, stop }`).
- **Allowed deps:** `contracts` (types + WS constants), `shared` (`shellEnv`), `bun-pty`,
  `@earendil-works/pi-coding-agent` (runtime, M10), Bun/Node.
- **Forbidden:** importing `web`/`cli`/`desktop`; being bundled into the browser.

## Surface (current — M8)

- `createServer({ port?, host?, staticDir? }) → { port, stop }`: `Bun.serve` with `/health`, a `/ws`
  upgrade, static SPA serving (when `staticDir` is set; `index.html` fallback, path-contained), and a WS
  that pushes **`server.welcome`** (`{ protocolVersion, projects }`) on open and dispatches requests.
- `dev.ts`: `resolveShellEnv()` → `createServer` from `THINKRAIL_PI_PORT`/`_HOST`/`_STATIC_DIR`.
- `handlers.ts`: the WS method→handler registry — `project.*`, `workspace.*`, `dialog.selectDirectory`,
  `fs.readDir`/`fs.readFile`, `git.status`/`git.diff`.
- `persistence.ts`: JSON app state under `dataDir()` — `THINKRAIL_PI_DATA_DIR` (dev/e2e isolation) else
  `~/.thinkrail-pi`. `projects.ts`: open a git repo as a project (validate via `git rev-parse
  --show-toplevel`, dedupe by root; assign a stable unique readable `slug`), list (by `lastOpened`), close.
- `workspaces.ts`: a workspace = a `git worktree` on its own branch under
  `dataDir/worktrees/<project-slug>/<branch>`; create (off the repo HEAD; **branch name made unique** — archiving
  leaves the branch behind, so re-creating must not collide), list (with diff stats), remove
  (`git worktree remove`; keeps the branch).
- `dialog.ts`: `selectDirectory()` — the host's **native** folder picker (macOS `osascript`), so the browser
  "Open project" gets a real OS dialog. `THINKRAIL_PI_PICK_DIR` overrides it for dev/e2e.
- `files.ts`: `readDir` / `readFile(workspaceId, path)` — list a directory / read a UTF-8 text file inside
  the active worktree (every path resolved + contained to the worktree root; `.git` hidden; dirs first).
- `git.ts`: `gitStatus` / `gitDiff(workspaceId, path?)` — a worktree's changed files + unified diff vs its
  base branch (untracked files listed, and shown in full via `--no-index`). `gitExec.ts` is the shared
  `git(cwd, args)` runner used here and by `workspaces.ts`.

## Get right (firms up as features land)

- **`prompt()` throws while a session is streaming** → `steer()`/`followUp()` (M10).
- **Errors arrive via the event stream + thrown methods, not a crash signal**; wrap + forward (M10).
- **No process isolation** — a fatal agent/provider fault takes the whole host down (accepted tradeoff).
- **WS commands return values directly**; only events + extension-UI use push channels.
- Binds beyond localhost via `host` (the Tailscale seam).

## Later

`AgentSessionManager` (M10), `project/workspace/git/fs/terminal` handlers (M4–M9), persistence behind a
data layer (V2), `owner` threading.
