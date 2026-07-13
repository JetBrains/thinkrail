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
and runs the `pi` agent in-process via `createAgentSession`. Launched in-process by `apps/cli` (and later
`apps/desktop`); it has no standalone entrypoint of its own (a `dev.ts` boots it for development / e2e).

## Boundary

- **Owns:** the HTTP+WS server, static serving, the WS dispatch registry, server-side feature services
  (project/workspace/git/fs/terminal + the in-process `AgentSession` manager), and `~/.thinkrail`
  persistence.
- **Public surface:** `createServer(options) → RunningServer` (`{ port, stop }`) and `bootHost(options)
  → BootedHost` (the process-boot wrapper: resolves the login-shell PATH, picks the port per `portMode`,
  and installs SIGINT/SIGTERM graceful-shutdown handlers around `createServer`), both re-exported from
  `host/`; plus `setBundledExtensions` (+ its types, re-exported from `agent/`) — the compiled-binary
  seam by which a launcher that cannot path-load the bundled pi extensions (no `node_modules` inside a
  `bun build --compile` binary) injects them as value-imported factories + a staged skills dir. The
  package also exposes the **`@thinkrail/server/agent` subpath export** (the `agent` barrel): the
  server-side session surface for the **headless workflow-test harness** (`e2e/workflows/`), which
  drives real in-process sessions through the production wiring without booting the HTTP host — a
  deliberate second entry that avoids evaluating `host` (Bun-only: `Bun.serve`, `bun-pty`) under the
  node-run e2e worker. Not for `apps/*` use — the web/CLI boundary rules are unchanged.
- **Allowed deps:** `contracts` (types + WS constants), `shared` (`shellEnv`), `bun-pty`,
  `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` (runtime), Bun/Node.
- **Forbidden:** importing `web`/`cli`/`desktop`; being bundled into the browser.

## Internal modules

Each lives in `src/<name>/` as a bounded sub-module: a `SPEC.md` (its own boundary) + an `index.ts`
**barrel** that is its only public surface. Siblings import a module **through its barrel, never its
internals**. The edges between them are owned here (see the dependency graph), not in the leaf specs.

| module | owns | spec |
| --- | --- | --- |
| `host` | `Bun.serve` HTTP+WS, static SPA, the WS dispatch registry, channel publish | [host/SPEC.md](src/host/SPEC.md) |
| `persistence` | JSON app state under the data dir (projects + workspaces) | [persistence/SPEC.md](src/persistence/SPEC.md) |
| `projects` | open/list/close git repos as projects (validate, dedupe, slug) | [projects/SPEC.md](src/projects/SPEC.md) |
| `workspaces` | workspaces = `git worktree`s on their own branch | [workspaces/SPEC.md](src/workspaces/SPEC.md) |
| `git` | the `git(cwd, args)` runner + worktree status/diff vs base + branch list | [git/SPEC.md](src/git/SPEC.md) |
| `github` | read-only local `gh` auth status (shell-out) for the New-Workspace surface | [github/SPEC.md](src/github/SPEC.md) |
| `fs` | read dirs/files inside a worktree (path-contained) | [fs/SPEC.md](src/fs/SPEC.md) |
| `spec` | the worktree's spec-graph snapshot (`spec.graph`) + project-level `projectHasSpecs`, via `pi-spec-graph/core` | [spec/SPEC.md](src/spec/SPEC.md) |
| `terminal` | workspace-scoped `bun-pty` terminals | [terminal/SPEC.md](src/terminal/SPEC.md) |
| `agent` | in-process pi `AgentSession`s + the shared pi runtime + one-shot completions | [agent/SPEC.md](src/agent/SPEC.md) |
| `auth` | provider status (`provider.status`) + in-app login (OAuth / API key / logout) | [auth/SPEC.md](src/auth/SPEC.md) |
| `assist` | ad-hoc one-shot tasks (workspace naming, …) on a cheap model, best-effort | [assist/SPEC.md](src/assist/SPEC.md) |
| `dialog` | the host's native folder picker | [dialog/SPEC.md](src/dialog/SPEC.md) |

`src/index.ts` re-exports `host` + the `agent` barrel's `setBundledExtensions` seam; `src/dev.ts` boots
the host from env via `bootHost` for dev/e2e.

## Internal dependency graph

`host` is the **only composition root** — it wires each feature's handlers into the WS registry.

- `host` → `projects`, `workspaces`, `git`, `github`, `fs`, `spec`, `terminal`, `dialog`, `agent`, `auth`, `assist`
- `workspaces` → `projects`, `git`, `persistence`
- `projects` → `git` (shared runner), `persistence`
- `git`, `fs`, `spec`, `terminal` → `persistence` (`spec` also → `pi-spec-graph/core`, external)
- `assist` → `agent` (the one-shot completion primitive)
- `auth` → `agent` (`getPiRuntime` — the shared `AuthStorage` + `ModelRegistry`; one-way, `agent` never imports `auth`)
- `agent` → (no internal deps — only the pi runtime)
- `persistence`, `dialog`, `github` → (leaves)

Rules: features never import `host`, and never each other except the edges above. The graph is acyclic.
`agent`'s WS surface (`session.*` + `pi.event` forwarding) attaches to `host`.

## Get right

- **No process isolation** — a fatal agent/provider fault takes the whole host down (accepted tradeoff).
- **WS commands return values directly**; only events + extension-UI use push channels.
- Binds beyond localhost via `host` option (the Tailscale seam).

## Later

Persistence behind a data layer (V2), `owner` threading.
