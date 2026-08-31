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
and runs the `pi` agent in-process via `createAgentSession`. Launched in-process by `apps/cli` and the
Electrobun `apps/desktop`; it has no standalone entrypoint of its own (a `dev.ts` boots it for development /
e2e).

## Boundary

- **Owns:** the HTTP+WS server, static serving, the WS dispatch registry, server-side feature services
  (project/workspace/git/fs/terminal + the in-process `AgentSession` manager), and `~/.thinkrail`
  persistence.
- **Public surface:** `createServer(options) → Promise<RunningServer>` (`{ port, stop, shutdown }`) —
  `stop()` is synchronous resource disposal for low-level tests while `shutdown()` is the idempotent,
  bounded production lifecycle (settle sessions + drain analytics, dispose sockets/PTYS/watchers, and
  release any attached ownership lease) every launcher must await — the public
  factory starts Central artifact watching and applies the initial current PI runtime before binding a socket
  or exposing handlers—falling back to a plain runtime with closed `load-failed` status when the configured
  Central extension fails—so every embedder gets the same bootstrap invariant — and
  `bootHost(options) → BootedHost` (the process-boot wrapper: installs crash logging, acquires the
  canonical-data-directory ownership lease before mutable host initialization, resolves the login-shell
  PATH, pre-warms the same initialization before choosing a port, awaits `createServer`, attaches the lease
  to its shared shutdown, and installs SIGINT/SIGTERM graceful-shutdown handlers), both re-exported from
  `host/`; plus `registerBundledRuntime` (+ its types, re-exported from `agent/`) — the compiled-binary
  seam by which a launcher that cannot path-load the bundled pi extensions (no `node_modules` inside a
  `bun build --compile` binary or packaged Electrobun server runtime) injects them as value-imported factories + a staged skills dir, injects
  the staged macOS/Windows OS-trash helper paths, and registers pi's statically-bundled provider flows
  (the OAuth flows + the Bedrock module) that pi otherwise reaches through binary-hostile
  variable-specifier dynamic imports (see the agent SPEC). Build-only
  **`@thinkrail/server/build-support`** is the single manifest of bundled extension entries, skill roots,
  per-platform `bun-pty` libraries, and trash helpers consumed by both launcher packagers. Test-only
  **`@thinkrail/server/artifact-probes`** owns the shared host-level artifact fixture/assertions behind thin
  CLI and desktop process/resource adapters. The package also exposes the
  **`@thinkrail/server/agent` subpath export** (the `agent` barrel): the
  server-side session surface for the **headless workflow-test harness** (`e2e/workflows/`), which
  drives real in-process sessions through the production wiring without booting the HTTP host — a
  deliberate second entry that avoids evaluating `host` (Bun-only: `Bun.serve`, `bun-pty`) under the
  node-run e2e worker. Not for `apps/*` use — the web/CLI boundary rules are unchanged.
- **Allowed deps:** `contracts` (types + WS constants), `shared` (`shellEnv`, the Central adapter, and the
  retrying teardown helper the artifact probes clean up with), `bun-pty`,
  `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai` (runtime), `pino` + its pretty/rolling
  destinations (host diagnostics), Bun/Node.
- **Deployment obligation:** product behavior lives in the owning server feature module and is composed by
  `host`; launchers only supply boot options and packaged resources. When a demonstrated second environment
  needs a different implementation, the owning feature defines one narrow injected port rather than a
  host-wide platform adapter.
- **Forbidden:** importing `web`/`cli`/`desktop`; being bundled into the browser; branching product behavior
  on launcher identity.

## Internal modules

Each lives in `src/<name>/` as a bounded sub-module: a `SPEC.md` (its own boundary) + an `index.ts`
**barrel** that is its only public surface. Siblings import a module **through its barrel, never its
internals**. The edges between them are owned here (see the dependency graph), not in the leaf specs.

| module | owns | spec |
| --- | --- | --- |
| `host` | `Bun.serve` HTTP+WS, static SPA, the WS dispatch registry, channel publish | [host/SPEC.md](src/host/SPEC.md) |
| `persistence` | JSON domain/config state under the data dir | [persistence/SPEC.md](src/persistence/SPEC.md) |
| `log` | explicit leveled diagnostics → pretty stderr + agent-oriented JSONL under `<dataDir>/logs` (pino-roll daily/10 MB rotation, 14 rotated + active); arbitrary console output stays terminal-only | [log/SPEC.md](src/log/SPEC.md) |
| `settings` | server-synced app config, including the shared custom-layout-preset catalog (never current/default layout) | [settings/SPEC.md](src/settings/SPEC.md) |
| `projects` | stable known-repo registry: open/recent views + lossless close/reopen (validate, dedupe, slug) | [projects/SPEC.md](src/projects/SPEC.md) |
| `workspaces` | workspaces = `git worktree`s on their own branch | [workspaces/SPEC.md](src/workspaces/SPEC.md) |
| `git` | the `git(cwd, args)` runner + worktree status/diff vs base + branch list | [git/SPEC.md](src/git/SPEC.md) |
| `subprocess` | `runBounded(argv, …)`: one child, one budget, killed by process group on expiry | [subprocess/SPEC.md](src/subprocess/SPEC.md) |
| `github` | read-only local `gh` auth status (shell-out) for the New-Workspace surface | [github/SPEC.md](src/github/SPEC.md) |
| `branch-review` | best-effort open GitHub PR / GitLab MR number for a workspace branch | [branch-review/SPEC.md](src/branch-review/SPEC.md) |
| `pr` | `pr.open`: push the workspace branch + open/update its GitHub PR, body rendered from the plan | [pr/SPEC.md](src/pr/SPEC.md) |
| `fs` | read dirs/files inside a worktree (path-contained) | [fs/SPEC.md](src/fs/SPEC.md) |
| `spec` | the worktree's spec-graph snapshot (`spec.graph`) + project-level `projectHasSpecs`, via `pi-spec-graph/core` | [spec/SPEC.md](src/spec/SPEC.md) |
| `todos` | a chat's per-session TODO plan read/write (`todo.*`), via `pi-todos/core` | [todos/SPEC.md](src/todos/SPEC.md) |
| `reviews` | draft review comments on files/diffs: store + anchoring + context-package render | [reviews/SPEC.md](src/reviews/SPEC.md) |
| `watch` | per-worktree fs watcher → debounced `workspace.fsChanged` invalidation push | [watch/SPEC.md](src/watch/SPEC.md) |
| `terminal` | workspace-scoped `bun-pty` terminals | [terminal/SPEC.md](src/terminal/SPEC.md) |
| `agent` | in-process pi sessions + current/retained runtime generations + one-shot completions | [agent/SPEC.md](src/agent/SPEC.md) |
| `auth` | provider status/login plus native JetBrains Central orchestration | [auth/SPEC.md](src/auth/SPEC.md) |
| `assist` | ad-hoc one-shot tasks (workspace naming, …) on a cheap model, best-effort | [assist/SPEC.md](src/assist/SPEC.md) |
| `analytics` | anonymous usage analytics: closed event set → PostHog sink (privacy contract in its spec) | [analytics/SPEC.md](src/analytics/SPEC.md) |
| `dialog` | the host's native folder picker | [dialog/SPEC.md](src/dialog/SPEC.md) |
| `editors` | detect installed editors/IDEs, launch one at a worktree, reveal a worktree in the file manager | [editors/SPEC.md](src/editors/SPEC.md) |
| `history` | prompt recall + conversation search over pi's session files | [history/SPEC.md](src/history/SPEC.md) |
| `templates` | file CRUD over pi's prompt-template dirs (global + project scoped) | [templates/SPEC.md](src/templates/SPEC.md) |

`src/index.ts` re-exports `host` + the `agent` barrel's `registerBundledRuntime` seam; explicit package
subpaths expose build support and artifact probes without widening the runtime barrel. `src/dev.ts` boots
the host from env via `bootHost` for dev/e2e.

## Internal dependency graph

`host` is the **only composition root** — it wires each feature's handlers into the WS registry.

- `host` → `projects`, `workspaces`, `git`, `github`, `branch-review`, `pr`, `fs`, `spec`, `todos`, `reviews`, `watch`, `terminal`, `dialog`, `editors`, `agent`, `auth`, `assist`, `settings`, `history`, `templates`, `analytics`, `log`, `persistence` (`dataDir`, for the crash report)
- `workspaces` → `projects`, `git`, `persistence`
- `branch-review` → `git`, `subprocess`
- `pr` → `workspaces`, `git`, `todos`, `branch-review` (provider detection + gh-output parsing + the shared CLI runner), `github` (`ghSetupProblem` — the named compare-fallback reason)
- `projects` → `git` (shared runner), `persistence`
- `git` → `subprocess` (every child that talks to a network or another CLI)
- `git`, `fs`, `spec`, `watch`, `terminal`, `settings`, `analytics` → `persistence` (`spec` also → `pi-spec-graph/core`, external; `analytics` also → the pi-ai built-in provider/model catalog + `posthog-node`, external—the identity-bucketing vocabulary and delivery SDK)
- `log` → `persistence` (`dataDir`) — and **any feature module (+ `host`) may → `log`**: it is the one
  cross-cutting edge, like `persistence`, exempt from the never-each-other rule (today: `host`,
  `agent`, `workspaces`, `watch`, `git`, `todos`, `reviews`, `analytics`). `persistence` never imports
  `log` (would cycle); `initLogging` is called only from `host`'s `bootHost`
- `todos` → `workspaces` (worktree path lookup) + `pi-todos/core` (external, value-imported, pi-free)
- `reviews` → `workspaces` (worktree path lookup), `persistence` (data dir), `git` (the review's baseSha
  resolve, plus the diff range + blob read behind a base-side anchor). The `review.send*` flows are
  **composed in `host`'s handlers** (reviews builds the package, `agent` runs the session — no
  `reviews`→`agent` edge; `host` serializes sends *and* review mutations per workspace via
  `reviewLock`, and re-attaches the review's persisted chat via `agent.ensureSessionAttached`), and the
  agent-side `resolve_comment` tool delegates back through a seam
  `host` installs (`agent.setReviewCommentHandler` → `reviews.resolveCommentFromAgent`)
- `assist` → `agent` (the one-shot completion primitive)
- `auth` → `agent` (the current runtime/auth facade plus candidate prepare/activate; one-way, `agent` never imports `auth`)
- `agent` → `log`, `persistence` (`dataDir` — the static state-root resolver; the delegation store lives at
  `<dataDir>/delegation`, bound in the agent's delegation embedding) — otherwise the pi runtime alone; auth
  passes desired opaque Central paths through its public generation seam
- `persistence`, `dialog`, `github`, `history`, `templates`, `subprocess` → (leaves)

Rules: features never import `host`, and never each other except the edges above. The graph is acyclic.
`agent`'s WS surface (`session.*` + `pi.event` forwarding) attaches to `host`. Features that push on their
own never import `host` either: they expose a **publisher-injection seam** (`setTerminalPublisher`,
`setSessionPublisher` + `setSessionCreatedPublisher` + `setSessionDeletedPublisher`, `setLoginPublisher`, `projects`' `setProjectPublisher` for the full-snapshot
`project.updated` lifecycle, `workspaces`' `setWorkspacePublisher` for the
`workspace.created`/`updated`/`removed` lifecycle trio, `settings`' `setSettingsPublisher` for
`settings.changed`, and auth's Central action analytics + `provider.changed` invalidation publishers) that
`host` installs at `createServer`—so channel/analytics wiring lives only in `host`. Current layout has no
host module, persistence, method, or publisher.

`settings` validates the bounded resource-free custom-layout-preset catalog it owns. Current/default preset,
group limits, frame, workspace resource placement, selection, and geometry never reach the host. The
workspace-create and boot-recovery paths compose `workspaces` with `terminal`: reserve the deterministic
process-free default terminal, then clear the workspace's pending marker only after durable catalog success. No sibling imports
another for that handshake.
`history` stays registry-free (never imports `projects`/`workspaces`); `host` injects the scope filter
+ labels from the registries at the handler layer (`history.search` handler). `templates` stays
registry-free too — it takes a plain `cwd`, never a `workspaceId`; the `template.*` handler resolves
`workspaceId` → `cwd` via `workspaces` before calling into `templates`.

Analytics is host-mediated the same way: **every `track()` call site lives in `host`** (boot,
session-create, login-success observation), and `host` syncs `setAnalyticsSending` off the settings
broadcast — `analytics` has no `settings` edge and no feature module knows analytics exists.

## Get right

- **No process isolation** — a fatal agent/provider fault takes the whole host down (accepted tradeoff).
- **One writer per data dir** — every production launcher enters through `bootHost`; ownership is a
  kernel-held loopback listener keyed by the canonical data-directory fingerprint, not a staleable file.
  Same-owner refusal is immediate, different-owner port collisions advance deterministically, and an
  occupied endpoint that cannot prove its identity fails closed.
- **One graceful shutdown** — launchers await `RunningServer.shutdown()`; repeated calls share one promise,
  while abrupt death relies on kernel release of the ownership listener.
- **WS commands return values directly**; only events + extension-UI use push channels.
- Binds beyond localhost via `host` option (the Tailscale seam).

## Later

Persistence behind a data layer (V2), `owner` threading.
