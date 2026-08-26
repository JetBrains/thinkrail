---
id: architecture
type: architecture-design
status: active
title: ThinkRail — top-level architecture
parent: goal-and-requirements
covers: [client-host-split, cli-entrypoint, wire-contract, transport-endpoint, ui-shell-panels, git-worktrees, remote-tailscale, hydrate-then-stream, domain-vs-view-state, shared-workspace-layout, client-local-navigation, central-integration]
tags: [v1, architecture]
---

## Drivers

The product is built around the `pi` agent, run **in-process** (`createAgentSession`). The V1 entrypoint
is a CLI you run that boots the engine host and opens a browser UI. Electrobun later supports a local-host
profile over that same host library and a shared-client profile that dials an existing host. The UI ships
independently of the host and dials it over the network; a phone reaches the selected host over Tailscale.

## Topology — three rings

- **Engine host** (`packages/server` + `packages/shared`, launched by `apps/cli` now / `apps/desktop`
  in local-host mode later): owns `pi`, session state, persistence, and serves the wire endpoint. It bundles pi extensions
  (`pi-web-access`, `pi-visualize`, `pi-spec-graph`, `pi-thinkrail-workflow`) into every session.
- **The wire** (`packages/contracts`): the typed, versioned protocol — the only coupling between client
  and host.
- **UI client** (`apps/web`): a mobile-first React client, transport-driven and endpoint-configurable,
  shippable as static assets independent of the host.

```
apps/cli        host launcher (V1): boot server + open browser   ── depends on ─▶ packages/server
apps/web        UI client (mobile-first)                          ── depends on ─▶ packages/contracts
apps/desktop    Electrobun local-host launcher/shared client (deferred) ── depends on ─▶ packages/server, packages/contracts
apps/website    public landing page + blog (GitHub Pages)         ── depends on ─▶ packages/website-analytics
apps/vibecoding-website  vibecoder landing (Cloudflare Pages)     ── depends on ─▶ packages/website-analytics
packages/website-analytics  dependency-free browser analytics policy shared by the two static sites
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
   (`resolveShellEnv` → `createServer` → open browser → signal handling). `apps/desktop` keeps that local
   profile with a native window and may also run as a shared client without starting a second host; both
   profiles use the same wire and web artifact.
3. **The wire is versioned.** `contracts` is types-only; `server.welcome` carries a protocol version so
   an independently-shipped UI can detect host-version drift.
4. **Transport endpoint is a parameter.** Defaults to same-origin (`location.host`); a remote browser,
   desktop, or mobile client points it at the selected host's Tailscale MagicDNS name. Native resume state
   is keyed by backend profile so ids from one host are never interpreted against another.
5. **UI = panels + shell.** Layout-agnostic, store-driven panels (project→workspace nav, file tree,
   Monaco editor, changes/diff, workspace-local review, terminal, chat, composer) never know their
   arrangement. The desktop shell owns one host-synchronized IDE workbench: a recursively split center plus
   auxiliary groups in vertical left/right stacks and a horizontally grouped bottom region with synchronized
   height/alignment. Singleton tools move among auxiliary regions; terminals may also occupy center, with new
   workspaces defaulting one terminal to bottom. A future mobile shell may project the same panels differently;
   desktop docking does not define that projection. Detail: [[submodule-web-shell-layout]].
6. **Workspaces are git worktrees (V1).** project (git repo) → workspace (`git worktree` on its own
   branch/cwd, under `~/.thinkrail/worktrees`) → {chats, files, terminals}. **Two deliberate
   exceptions, both `kind`-marked on the wire and both *user-owned* — never renamed or reclaimed by
   ThinkRail:** every project carries exactly one built-in **Default workspace** (`kind: "default"`)
   whose cwd is the project folder itself (git's *main working tree*) — non-removable, non-renamable,
   and entered explicitly from the project's Welcome fork ("Work in project folder"), never
   auto-entered — the "just work in my project folder" anchor for users lost in the
   worktree model; and an **existing worktree** the user explicitly attaches in place
   (`kind: "external"`), which ThinkRail may forget but never mutates (see
   [[submodule-server-workspaces]]). The shell is built first,
   `pi` connected last. Provider-backed PR / Checks stay V2 beyond a best-effort open GitHub PR or GitLab MR number in active-workspace metadata; workspace-local Review is V1.
7. **Auth is external.** Tailscale ACLs / device identity are the auth; the app carries an `owner` field,
   not a login UI.
8. **Hydrate-then-stream (every client reconstructs from the host).** A client never relies on having
   *witnessed* events to know state — on connect it **reads** the current state, then **subscribes** to
   live deltas. The host exposes the read side of the wire (`project.list` / `workspace.list` /
   **`session.list`** / **`session.getMessages`**) alongside the `pi.event` delta stream. So a reload, a
   second tab, a phone, or a **host restart** all rebuild the same view: `session.list` unions the host's
   in-memory sessions (auto-restored as tabs) with pi's **on-disk** sessions (surfaced in chat-history,
   re-opened on demand via `session.getMessages`, which attaches the persisted session back into the host).
   The client is a **stateless projection**, never a second source of truth. An automatic agent run
   remains active through retries, compaction, and queued continuations: pi's `agent_end` is only an
   attempt boundary and may precede more work; `agent_settled` is the authoritative transition to idle.
9. **Domain state, shared placement, and local attention.** *Domain* state — projects, workspaces,
   **sessions + their transcripts**, terminals, git — is backend-owned, shared, and persistent; every
   client hydrates it from the host. Workspace **placement state is deliberately shared too**: one
   versioned host document owns center plus left/right/bottom auxiliary topology, open resource references,
   tab order, preview identities, folds/visibility, and normalized geometry. Layout schema version 2 adds
   bottom explicitly and migrates known version-1 documents to hidden/empty bottom without moving a resource;
   a generic region map was rejected as an unnecessary rewrite of stable side contracts, while a separate
   bottom snapshot would make cross-region moves non-atomic. A migrated snapshot is reported at revision 2
   or later, so revision 1 identifies a first persisted version-2 layout—but not the age of its workspace.
   Default-terminal seeding additionally requires the host-owned `Workspace.initialTerminalEligible` marker,
   written only when a workspace record is first created; legacy records are never backfilled. Valid full
   snapshots converge by monotonic revision, but
   replacement is optimistic-concurrency guarded: a client names its exact accepted revision
   (or create-only absence), and a stale full replacement conflicts with the current snapshot instead of
   making the last arrival win. Left/right/bottom visibility, folds, extents, and bottom alignment are
   structural; this remains placement only, never resource lifetime. *Attention and drafts* — selected tab per
   group, last-focused group, uncommitted pointer/resize drafts, composer drafts — remain
   per-client (ephemeral or local reload persistence), so one browser cannot steal another's focus. The active
   client location is likewise local: one backend-relative route names main / Project Home / workspace / exact
   chat; web stores it in a versioned fragment, while later native shells persist it per backend profile and
   window/device. Incoming ids are validated against hydrated host state, and no backend-owned “current screen”
   lets one client move another.
   Corollary: closing a file/chat placement is a shared view action, not a domain dispose — the session
   remains; terminal close retains its separate explicit PTY-lifetime semantics. Detail:
   [[submodule-server-layout]] and [[submodule-web-shell-layout]].
10. **Dependencies pin exact versions.** Every dependency in every manifest pins an **exact** version — no
    ranges (`^` `~` `>` `<` `.x` `*`). Rationale: `pi` ships breaking releases daily, so a floating range is
    a live wire; more broadly, a silent minor/patch bump is the classic irreproducible-build trap. Exact
    pins make the lockfile the single source of a dependency's version and turn every upgrade into an
    explicit, reviewable diff. Cross-cutting deps (pi, TypeScript, typebox, bun types) are pinned **once** in
    the root `workspaces.catalog` and referenced via `catalog:`, so their version lives in exactly one place.
    **Enforced**, not just documented: `scripts/check-catalog.ts` (`bun run check:deps`, in pre-commit + CI)
    rejects any range and any catalog drift. Exempt: `peerDependencies` (extension packages declare `"*"` on
    purpose — the host provides the dep) and local protocols (`workspace:` / `link:` / `file:`).

11. **Terminal = xterm.js on the DOM renderer.** The browser terminal is `@xterm/xterm`, driven from
    `apps/web/src/panels/TerminalInstance.tsx` against a real PTY (`bun-pty`) in
    `packages/server/src/terminal`. It stays the choice because it is the only production-ready browser
    terminal: the credible alternatives are all Ghostty's VT engine compiled to WebAssembly (`ghostty-web`,
    `restty`, `wterm`), and the most mature of them has a single tagged release that can do neither mouse
    reporting nor OSC 8 links — vim/htop/lazygit would regress. **The renderer is deliberately the default
    DOM one**, not `addon-webgl`: xterm's own maintainer names the DOM renderer a prerequisite for touch
    support, and WebGL carries defects we would inherit (`WebglAddon.dispose()` leaks its WebGL2 context —
    fatal for our per-worktree terminal churn — plus iOS context-limit crashes). Loading `addon-webgl` would
    be a regression, not an upgrade; ligatures and `rescaleOverlappingGlyphs` are the accepted cost. Coupling
    is kept deliberately thin (about a dozen xterm API members; no parser hooks, decorations or
    serialization), so a swap stays a contained rewrite of one file. **Re-evaluate when both** (a) upstream
    tags `libghostty-vt` with an official WASM/npm distribution, and (b) `ghostty-web` ships past 0.4.0 with
    mouse reporting and OSC 8 working.

12. **A shell belongs to a tab, and the host owns the mapping.** Terminals are keyed by
    `(workspaceId, tabKey)`; `terminal.reserve` may durably establish the catalog tab without a process, while
    one idempotent `terminal.attach` remains the only way its PTY is born. Reservation persists before
    publishing membership and rolls back its in-memory insertion if persistence fails. This separation lets a
    synchronized hidden default placement survive reload and another client without starting a shell. The
    client keeps no tab→shell pointer of its own. Shells are **owner-scoped**, matching `history`/`todos`/`templates`, so
    they survive a reload, a closed browser and a different browser — attach is exclusive, and taking a tab
    over notifies the displaced client. Lifetime is bounded by reference (no tab → no shell) plus the host
    process, **not** by timers: no idle culling, no abandoned-client reap. A host restart cannot preserve
    shells (in-process `pi`, PTY hangup), so tabs are revived with fresh shells showing recorded output.
    **tmux was rejected** as the persistence layer: an unassumable dependency on Windows, a competing tab
    model, env-propagation breakage, and polling-based capture — for restart survival we have already
    decided not to hold. Detail: [[submodule-server-terminal]].
13. **Central's cross-module lifecycle has one architectural owner.** Its adapter, runtime generation,
    wire status, and card remain in their bounded modules; the correspondence between those surfaces and
    their liveness obligations belongs to [[central-integration]]. This keeps feature-specific mechanics in
    their leaf specs while making a non-terminating composition visible at the architecture layer.

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
provider-backed PR / Checks, self-improvement, automations, per-step model routing, cost ledger.
