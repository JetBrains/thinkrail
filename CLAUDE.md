# ThinkRail-PI

A ThinkRail-branded desktop-and-mobile client for the `pi` coding agent. The app is a thin host that
runs `pi` and bridges it to a rich UI; `pi` owns models, skills, compaction, cost, and session state.

Canonical specs (read these first):
- `goal-and-requirements.md` — product goal + V1/V2 scope
- `architecture.md` — top-level architecture, decisions, invariants

## Module structure & boundaries (top-priority requirement)

The app is built as a set of **clearly bounded modules**. This is a primary design requirement, not a
nice-to-have — treat it with the same weight as the non-negotiable invariants below.
- **Modules are fractal.** The boundary rule applies at *every* level: each package is a module, and the
  directories *inside* a package (`packages/server/src/agent/`, `apps/web/src/transport/`, …) are modules
  too. A sub-module is a directory with an `index.ts` **barrel** as its only public surface; siblings
  import it **through that barrel, never its internals**. (Exception: where a barrel would defeat
  code-splitting or a library's per-file convention — e.g. `apps/web/src/panels` and `components/ui`,
  which lazy-load Monaco/shiki/xterm — imports stay per-file and the boundary is held by spec + convention.)
- **Every module has a `SPEC.md`** that states its boundary explicitly: what it owns, what it exposes
  as its public surface, and what it must *not* reach into (allowed deps and forbidden deps). The
  **dependency edges *between* sibling sub-modules live in the parent module's `SPEC.md`** (a dependency
  graph), not in each leaf — leaves declare only their own external deps + forbidden reaches.
- **Boundaries should be covered by tests** where practical — a module's public surface and its
  boundary rules are worth exercising with tests, not just relying on convention. This is a goal, not a
  hard gate: aim for coverage, but don't block on guaranteeing it everywhere.
- **The spec leads the code.** A change that moves or blurs a boundary updates the module's `SPEC.md`
  first, then the code and the tests that pin it.

## Engine: `pi` only, in-process

Built around the `pi` coding agent, run **in-process** via `@earendil-works/pi-coding-agent`
(`createAgentSession`) — not a subprocess. No second runtime (no `claude-agent-sdk`), V1 or V2. We never
assemble the prompt ourselves; we influence the agent only by what we feed `pi` (context, files, `pi`
skills/extensions) and which flags we spawn it with.

Tradeoff: in-process means **no crash isolation** — a fatal agent/provider fault takes the whole host
down. Sessions still run concurrently (cooperative on one event loop); the subprocess RPC mode is the
only alternative if fault isolation ever becomes worth the complexity.

> The package scope is `@earendil-works/*`. The `@mariozechner/*` scope is the **deprecated** old name —
> do not use it.

## Architecture (three rings)

- **Engine host** — `packages/server` (+ `packages/shared`), launched by `apps/cli` (V1) or
  `apps/desktop` (Electrobun, deferred). `createServer()` = `Bun.serve` HTTP+WS + `AgentSessionManager`
  (one in-process `AgentSession` per tab) + handlers + persistence.
- **The wire** — `packages/contracts`: the typed, versioned protocol. Types-only.
- **UI client** — `apps/web`: mobile-first React, ships independently, dials a host over the wire.

V1 entrypoint is `apps/cli`: a `thinkrail-pi` bin that boots the host in-process and opens the browser.
Remote/phone access (V2) is over Tailscale; auth stays external (the app carries an `owner` field).

**V1 shape (Worktree IDE):** left = projects (git repos) → workspaces (each a `git
worktree`, own branch/cwd, under `~/.thinkrail-pi/worktrees`); center = a tabbed area of Monaco file tabs
+ chat tabs; right = an All-files tree + Changes (git diff) + terminals, all scoped to the active
worktree. The shell is built **first**, `pi` connected **last**. Deferred to V2: spec-graph viewer,
PR/Checks/Review.

## Repo layout

```
goal-and-requirements.md, architecture.md   top-level specs (repo root)
apps/
  cli/        V1 entrypoint: boot host + open browser   (SPEC.md)
  web/        mobile-first UI client                    (SPEC.md)
  desktop/    Electrobun launcher — DEFERRED            (SPEC.md)
packages/
  server/     createServer(): Bun.serve + AgentSessionManager  (SPEC.md)
  contracts/  the wire (types-only)                     (SPEC.md)
  shared/     shellEnv (server-side only)               (SPEC.md)
```

## Spec graph (how decisions are recorded)

Architecture decisions live as spec-graph nodes, dogfooding the spec layer the product is about:
- Top-level specs (`goal-and-requirements.md`, `architecture.md`) in the **repo root**.
- Each module's spec is co-located as `<module>/SPEC.md`.
- Frontmatter: `id`, `type` (goal-and-requirements | architecture-design | module-design |
  submodule-design | task-spec), `status` (draft | active | stale | done | deprecated), `title`,
  `parent` (single link), `depends-on` / `references` / `implements` (link lists), `covers` / `tags`.
- **Specs are the source of truth and are updated during implementation.** A module spec is `draft`
  until its design firms up, then `active`. Keep them honest as code lands.

## Non-negotiable invariants

- **`apps/web` depends on `packages/contracts` only** — never on `server`/`shared`. This is what makes
  the UI shippable without the host.
- **Never *value*-import `pi` in browser-bundled code; import types only, from the `pi-ai` /
  `pi-agent-core` package roots** (`verbatimModuleSyntax` erases type-only imports, so no runtime reaches
  the bundle). `@earendil-works/pi-coding-agent` is server-only and never reaches `contracts`/`web` (it
  pulls `node:fs` + provider SDKs). `pi-agent-core` + `pi-ai` are type-only devDeps of `contracts`.
- **One id model:** the UI tab id vs `session.sessionId` (the `AgentSession` id). No separate pi UUID.
- **`pi` owns state**; the host is a thin bridge and does not recompute what `pi` reports (cost, stats).
- **Streaming:** `text_delta` / `thinking_delta` **APPEND**; `tool_execution_update.partialResult`
  **REPLACE**.
- **`prompt()` throws while a session is streaming** → call `steer()` / `followUp()`. Errors arrive via
  the event stream + thrown methods, not a crash signal — wrap each call and forward to the WS client.
- **UI panels are layout-agnostic**; the shell arranges them (desktop multi-pane / mobile single-view).
- **Web styling = Tailwind v4 utilities mapped to the CSS-var tokens** (`@theme inline` in
  `apps/web/src/index.css`); themes swap the token set via `[data-theme]`. Components use utilities,
  **never inline `style` objects or raw hex** — that's what keeps the UI themeable and responsive.
- **Icons: `lucide-react` only. UI primitives: shadcn/ui** (Radix), copied into
  `apps/web/src/components/ui/` (we own them) and themed with our token utilities — *not* shadcn's
  default palette. `cn()` lives in `apps/web/src/lib/utils.ts`.
- The transport's **host endpoint is a parameter** (default same-origin); `server.welcome` carries a
  protocol version so an independently-shipped UI can detect host drift.

## Chat UI (the conversation renderers)

The agent conversation is rendered by **hand-rolled React primitives** in `apps/web/src/chat/` — pi ships
no web UI, and the official `@earendil-works/pi-web-ui` (MIT) is **Lit + runs the agent in-browser**, so
it's a *reference* for the event→render mapping, not a dependency. The primitives render **pi's canonical
message / content-block model** (`AssistantMessage.content`: `text` / `thinking` / `toolCall`), so they're
reusable by any pi UI (extraction-ready as a future `packages/chat-ui`).
- **Presentational renderers are props-driven** (no store/transport) so they stay reusable; `ChatView` is
  the only app-integration piece (wires store + transport). Theme **only via token utilities** so the
  primitives wear any theme.
- **Adding a tool = two decoupled sides, joined by tool name:** the **capability** is a pi **custom tool /
  extension/skill** (server-side, passed to `createAgentSession`); the **presentation** is a UI renderer
  registered via **`registerToolRenderer("<name>", …)`** (`chat/toolRegistry`) — unregistered tools fall
  back to `DefaultToolRenderer`. Interactive tools route through the `pi.extensionUi` bridge.
- Full module spec: `apps/web/src/chat/SPEC.md`.

## Verification (run for every app-affecting change)

Every change that touches the app is verified by the **e2e suite** before it's considered done.
`bun run e2e` is **fully self-contained**: it builds the web app, boots the host on a dedicated port
(24252) with an **isolated state dir** (never touches `~/.thinkrail-pi`), seeds fixtures (Playwright
`globalSetup`), runs the suite headless against the real web UI, then tears the host down and cleans up
(`globalTeardown`). Tests live in `e2e/` and assert via `data-testid` / `data-status` hooks. When
Electrobun lands, the same suite runs against the desktop app too.

**Agent tests are tagged, not faked.** Specs that drive a real `pi` agent are tagged `@agent` (Playwright
`{ tag: "@agent" }`). The host runs against an **isolated pi agent dir** (`PI_CODING_AGENT_DIR` → a
throwaway dir under the e2e data dir; `globalSetup` copies the user's pi auth config (`auth.json` **+
`models.json`** — auth lives in both: OAuth providers in `auth.json`, apiKey providers in `models.json`) so a
real provider works, and seeds a `settings.json` pinning a **deterministic default model** — override with
`THINKRAIL_PI_E2E_MODEL=<provider>/<modelId>`) — so a test's `setModel`/`setThinkingLevel` persists *there*,
**never the user's real `~/.pi/agent`**. (Corollary: don't let an `@agent` test *select* a model — it would
pin a default mid-run.) Select suites by marker: `bun run e2e`
runs the **no-agent** suite (`--grep-invert @agent`) — projects/workspaces/files/editor/changes/terminals,
fast, no auth, run anytime; `bun run e2e:full` runs everything; `bun run e2e:agent` runs only the
`@agent` specs (which need `pi` authenticated + more time). There is **no fake agent** — agent coverage
runs against a real provider.

Fast gates (also the husky pre-commit): `bun run lint` (biome) + `bun run typecheck`. Unit tests:
`bun run test` (bun test, per package). One-time setup for a fresh machine: `bunx playwright install chromium`.

## Stack

Bun + Turbo monorepo · TypeScript (strict) · React 19 + Zustand + Tailwind v4 (web) · in-process `pi`
via `@earendil-works/pi-coding-agent` (Node ≥ 22.19). On-disk app state under `~/.thinkrail-pi`.
