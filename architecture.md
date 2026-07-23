---
id: architecture
type: architecture-design
status: active
title: ThinkRail — top-level architecture
parent: goal-and-requirements
covers: [client-host-split, cli-entrypoint, wire-contract, transport-endpoint, ui-shell-panels, git-worktrees, remote-tailscale, hydrate-then-stream, domain-vs-view-state]
tags: [v1, architecture]
---

## Drivers

The product is built around the `pi` agent, run **in-process** (`createAgentSession`). The V1 entrypoint
is a CLI you run that boots the engine host and opens a browser UI; Electrobun is a later launcher over
the same host. The UI ships independently of the host and dials it over the network; a phone reaches the
host over Tailscale.

## Topology — three rings

- **Engine host** (`packages/server` + `packages/shared`, launched by `apps/cli` now / `apps/desktop`
  later): owns `pi`, session state, persistence, and serves the wire endpoint. It bundles pi extensions
  (`pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-thinkrail-workflow`) into every session.
- **The wire** (`packages/contracts`): the typed, versioned protocol — the only coupling between client
  and host.
- **UI client** (`apps/web`): a mobile-first React client, transport-driven and endpoint-configurable,
  shippable as static assets independent of the host.

```
apps/cli        host launcher (V1): boot server + open browser   ── depends on ─▶ packages/server
apps/web        UI client (mobile-first)                          ── depends on ─▶ packages/contracts
apps/desktop    Electrobun host launcher (deferred)               ── depends on ─▶ packages/server, packages/contracts
apps/website    public landing page (GitHub Pages)                ── standalone: no workspace deps
packages/server createServer(): Bun.serve(HTTP+WS) + AgentSessionManager (in-process pi) ── depends on ─▶ packages/contracts, packages/shared
packages/contracts  the wire (types-only)
packages/shared     shellEnv (server-side only)
packages/spec-graph portable pi extension: spec_* tools + skill (bundled into every session by packages/server;
                    its pi-free core/ read model also backs the host's spec.graph read method)
packages/pi-visualize          portable pi extension: the visualize tool (bundled into every session)
packages/pi-thinkrail-workflow pi extension: the workflow skill system + its always-on routing rule
                    (bundled into every session; workspace-internal, not portable)
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
   branch/cwd, under `~/.thinkrail/worktrees`) → {chats, files, terminals}. The shell is built first,
   `pi` connected last. Real PR / Checks / Review stay V2.
7. **Auth is external.** Tailscale ACLs / device identity are the auth; the app carries an `owner` field,
   not a login UI.
8. **Hydrate-then-stream (every client reconstructs from the host).** A client never relies on having
   *witnessed* events to know state — on connect it **reads** the current state, then **subscribes** to
   live deltas. The host exposes the read side of the wire (`project.list` / `workspace.list` /
   **`session.list`** / **`session.getMessages`**) alongside the `pi.event` delta stream. So a reload, a
   second tab, a phone, or a **host restart** all rebuild the same view: `session.list` unions the host's
   in-memory sessions (auto-restored as tabs) with pi's **on-disk** sessions (surfaced in chat-history,
   re-opened on demand via `session.getMessages`, which attaches the persisted session back into the host).
   The client is a **stateless projection**, never a second source of truth.
9. **Domain state vs. view state.** *Domain* state — projects, workspaces, **sessions + their
   transcripts**, git — is backend-owned, shared across all clients, and persistent; every client hydrates
   it from the host. *View* state — which sessions are open as tabs, the active tab, composer drafts, panel
   sizes — is **per-client** and lives only in that client (ephemeral, or localStorage for reload-restore);
   it is never sent to the backend (that would couple clients to each other). Corollary: **closing a tab is
   a view action, not a domain dispose** — a session stays alive for other clients; disposing/deleting a
   session is a separate, explicit domain action.
10. **Dependencies pin exact versions.** Every dependency in every manifest pins an **exact** version — no
    ranges (`^` `~` `>` `<` `.x` `*`). Rationale: `pi` ships breaking releases daily, so a floating range is
    a live wire; more broadly, a silent minor/patch bump is the classic irreproducible-build trap. Exact
    pins make the lockfile the single source of a dependency's version and turn every upgrade into an
    explicit, reviewable diff. Cross-cutting deps (pi, TypeScript, typebox, bun types) are pinned **once** in
    the root `workspaces.catalog` and referenced via `catalog:`, so their version lives in exactly one place.
    **Enforced**, not just documented: `scripts/check-catalog.ts` (`bun run check:deps`, in pre-commit + CI)
    rejects any range and any catalog drift. Exempt: `peerDependencies` (extension packages declare `"*"` on
    purpose — the host provides the dep) and local protocols (`workspace:` / `link:` / `file:`).

## Invariants

- Never **value**-import `pi` in browser-bundled code; import types only, from the `pi-ai` /
  `pi-agent-core` package roots (type-only imports are erased at build, keeping the bundle provider-free).
  `@earendil-works/pi-coding-agent` is server-only — it never reaches `contracts`/`web`.
- One id model: the UI tab id vs `session.sessionId` (the `AgentSession` id). No separate pi UUID.
- The agent runs in-process with **no crash isolation** — wrap session calls and forward errors; a fatal
  fault takes the whole host down (accepted tradeoff vs the subprocess RPC mode).
- `pi` owns state and emits the truth; the host is a thin bridge — it **exposes** `pi`'s state through read
  methods (it does not recompute it) and forwards `pi`'s events as deltas. Clients **hydrate from the reads,
  then stream the deltas** — they hold only view state of their own.

## Out of scope (V1)

The workflow **product layer** (a runtime/engine, configurable pipelines) — the skill-based workflow
*system* ships in V1 as a bundled extension (`module-thinkrail-workflow`: skills + one always-on
rule, no runtime machinery); the spec-graph **product layer** beyond the read-only viewer (drift detection, pre-build
approval, living graph) — the pi-side spec-graph *capability* ships in V1 as a bundled extension
(`module-spec-graph`), and the V1 viewer is a read-only Specs tab over a `spec.graph` wire read;
self-improvement, automations, per-step model routing, cost ledger.
