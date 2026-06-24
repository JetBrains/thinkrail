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
  (project/workspace/git/fs/terminal + the in-process `AgentSession` manager), and `~/.thinkrail-pi`
  persistence.
- **Public surface:** `createServer(options) → RunningServer` (`{ port, stop }`), re-exported from `host/`.
- **Allowed deps:** `contracts` (types + WS constants), `shared` (`shellEnv`), `bun-pty`,
  `@earendil-works/pi-coding-agent` (runtime), Bun/Node.
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
| `git` | the `git(cwd, args)` runner + worktree status/diff vs base | [git/SPEC.md](src/git/SPEC.md) |
| `fs` | read dirs/files inside a worktree (path-contained) | [fs/SPEC.md](src/fs/SPEC.md) |
| `terminal` | workspace-scoped `bun-pty` terminals | [terminal/SPEC.md](src/terminal/SPEC.md) |
| `agent` | in-process pi `AgentSession`s + the shared pi runtime | [agent/SPEC.md](src/agent/SPEC.md) |
| `dialog` | the host's native folder picker | [dialog/SPEC.md](src/dialog/SPEC.md) |

`src/index.ts` re-exports `host`; `src/dev.ts` boots `createServer` from env for dev/e2e.

## Internal dependency graph

`host` is the **only composition root** — it wires each feature's handlers into the WS registry.

- `host` → `projects`, `workspaces`, `git`, `fs`, `terminal`, `dialog`
- `workspaces` → `projects`, `git`, `persistence`
- `projects`, `git`, `fs`, `terminal` → `persistence`
- `agent` → (no internal deps — only the pi runtime)
- `persistence`, `dialog` → (leaves)

Rules: features never import `host`, and never each other except the edges above. The graph is acyclic.
`agent`'s WS surface (`session.*` + `pi.event` forwarding) attaches to `host` at M11.

## Get right

- **No process isolation** — a fatal agent/provider fault takes the whole host down (accepted tradeoff).
- **WS commands return values directly**; only events + extension-UI use push channels.
- Binds beyond localhost via `host` option (the Tailscale seam).

## Later

`session.*` WS methods + `pi.event` forwarding (M11, with the chat UI), extension-UI bridge via
`bindExtensions` (M12), persistence behind a data layer (V2), `owner` threading.
