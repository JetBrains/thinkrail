---
id: architecture
type: architecture-design
status: active
title: ThinkRail-PI — top-level architecture
parent: goal-and-requirements
covers: [client-host-split, cli-entrypoint, wire-contract, transport-endpoint, ui-shell-panels, git-worktrees, remote-tailscale]
tags: [v1, architecture]
---

## Drivers

The product is built around the `pi` agent, run **in-process** (`createAgentSession`). The V1 entrypoint
is a CLI you run that boots the engine host and opens a browser UI; Electrobun is a later launcher over
the same host. The UI ships independently of the host and dials it over the network; a phone reaches the
host over Tailscale.

## Topology — three rings

- **Engine host** (`packages/server` + `packages/shared`, launched by `apps/cli` now / `apps/desktop`
  later): owns `pi`, session state, persistence, and serves the wire endpoint.
- **The wire** (`packages/contracts`): the typed, versioned protocol — the only coupling between client
  and host.
- **UI client** (`apps/web`): a mobile-first React client, transport-driven and endpoint-configurable,
  shippable as static assets independent of the host.

```
apps/cli        host launcher (V1): boot server + open browser   ── depends on ─▶ packages/server
apps/web        UI client (mobile-first)                          ── depends on ─▶ packages/contracts
apps/desktop    Electrobun host launcher (deferred)               ── depends on ─▶ packages/server, packages/contracts
packages/server createServer(): Bun.serve(HTTP+WS) + AgentSessionManager (in-process pi) ── depends on ─▶ packages/contracts, packages/shared
packages/contracts  the wire (types-only)
packages/shared     shellEnv (server-side only)
```

## Decisions

1. **Client/host split.** Engine host owns `pi` and state; the UI is a portable client; the wire is the
   only coupling. **Rule: `apps/web` depends on `packages/contracts` only** — never on `server` or
   `shared`. That single edge is what makes the UI shippable without the host.
2. **CLI is the V1 launcher; `createServer()` is a library.** `apps/cli` is a thin launcher
   (`resolveShellEnv` → `createServer` → open browser → signal handling). `apps/desktop` is the same
   launcher with a native window instead of a browser.
3. **The wire is versioned.** `contracts` is types-only; `server.welcome` carries a protocol version so
   an independently-shipped UI can detect host-version drift.
4. **Transport endpoint is a parameter.** Defaults to same-origin (`location.host`); a remote client
   points it at the host's Tailscale MagicDNS name.
5. **UI = panels + shell.** Layout-agnostic, store-driven panels (project→workspace nav, file tree,
   Monaco editor, changes/diff, terminal, chat, composer); the **center is a tabbed area holding file
   tabs + chat tabs**. The shell arranges panels by layout mode: desktop multi-pane /
   mobile single-view-with-switcher. Both modes share the same panels and store.
6. **Workspaces are git worktrees (V1).** project (git repo) → workspace (`git worktree` on its own
   branch/cwd, under `~/.thinkrail-pi/worktrees`) → {chats, files, terminals}. The shell is built first,
   `pi` connected last. Real PR / Checks / Review stay V2.
7. **Auth is external.** Tailscale ACLs / device identity are the auth; the app carries an `owner` field,
   not a login UI.

## Invariants

- Never **value**-import `pi` in browser-bundled code; import types only, from the `pi-ai` /
  `pi-agent-core` package roots (type-only imports are erased at build, keeping the bundle provider-free).
  `@earendil-works/pi-coding-agent` is server-only — it never reaches `contracts`/`web`.
- One id model: the UI tab id vs `session.sessionId` (the `AgentSession` id). No separate pi UUID.
- The agent runs in-process with **no crash isolation** — wrap session calls and forward errors; a fatal
  fault takes the whole host down (accepted tradeoff vs the subprocess RPC mode).
- `pi` owns state and emits the truth; the host is a thin bridge and does not recompute what `pi` reports.

## Out of scope (V1)

Workflows, editable specs / drift detection, self-improvement, automations, per-step model routing,
cost ledger. See `docs/V2-ROADMAP.md`.
