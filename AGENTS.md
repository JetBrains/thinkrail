# ThinkRail

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

- **Engine host** — `packages/server` (+ `packages/shared`), launched in-process by `apps/cli` or
  `apps/desktop` (Electrobun). `createServer()` = `Bun.serve` HTTP+WS + `AgentSessionManager`
  (one in-process `AgentSession` per tab) + handlers + persistence.
- **The wire** — `packages/contracts`: the typed, versioned protocol. Types-only.
- **UI client** — `apps/web`: mobile-first React, ships independently, dials a host over the wire.

V1 has two additive entrypoints: `apps/cli` boots the host in-process and opens the browser, while
`apps/desktop` packages the same host and web client in Electrobun. Remote/phone access (V2) is over
Tailscale; auth stays external (the app carries an `owner` field).

**V1 shape (Worktree IDE):** left = projects (git repos) → workspaces (each a `git
worktree`, own branch/cwd, under `~/.thinkrail/worktrees`); center = a tabbed area of Monaco file tabs
+ chat tabs; right = a Files tree + Changes (git diff) + terminals, all scoped to the active
worktree. The shell is built **first**, `pi` connected **last**. Deferred to V2: spec-graph viewer,
PR/Checks.

## Repo layout

```
goal-and-requirements.md, architecture.md   top-level specs (repo root)
central-integration.md                      cross-module spec: JetBrains AI via Central
apps/
  cli/        V1 entrypoint: boot host + open browser   (SPEC.md)
  web/        mobile-first UI client                    (SPEC.md)
  desktop/    Electrobun local-host launcher             (SPEC.md)
  website/    public landing + blog + vibecoding (Cloudflare Pages) (SPEC.md)
packages/
  server/     createServer(): Bun.serve + AgentSessionManager  (SPEC.md)
  contracts/  the wire (types-only)                     (SPEC.md)
  shared/     shellEnv (server-side only)               (SPEC.md)
  spec-graph/ portable pi extension: spec_* tools + skill (SPEC.md)
  pi-delegation/ portable pure-pi delegation core: child sessions from sessions (SPEC.md)
  pi-subagents/  portable pure-pi extension: Agent tools over pi-delegation (SPEC.md)
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
- **Comments: avoid them. Near-zero is the norm.** Decisions, invariants, trade-offs, rejected
  alternatives, protocol history, bug post-mortems — all of it lives in the owning `SPEC.md` (or the
  test that pins it), never in code comments. Code carries meaning through names, types, and control
  flow. The only comments that may exist: lint/type directives (`biome-ignore` with a reason,
  `/// <reference`) and a *rare* one-line hazard note where misediting silently breaks something no
  type or test can pin — usually ending in a `see <SPEC>` pointer. A comment spanning multiple lines
  is content that belongs in a spec: move it. Never narrate code or duplicate spec prose beside it.

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
- **Automatic work ends at `agent_settled`, never `agent_end`.** `agent_end` is attempt-level and may be
  followed by provider retry, compaction/recovery, or a queued continuation even when `willRetry` is false.
- **UI panels are layout-agnostic**; the shell arranges them (desktop multi-pane / mobile single-view).
- **Web styling = Tailwind v4 utilities mapped to the CSS-var tokens** (`@theme inline`). The `@theme`
  token families are GENERATED from JSON sources into `styles/generated/`, each carrying its own
  `@theme inline` block (Tailwind flattens imports before resolving the theme, so an imported block
  registers like an inline one): colour (`styles/colors.json` → `styles/generated/colors.css`) and
  spacing (`styles/spacing.json` → `styles/generated/spacing.css`, which **owns the Tailwind `--spacing`
  base mapping**). `apps/web/src/index.css` is the integration point — it `@import`s the generated layers
  and holds only the non-generated remainder (Preflight font defaults, chrome geometry such as
  `--spacing-panel-header-row`, animations); it does **not** own the `--spacing` mapping. Themes swap the
  token set via `[data-theme]`. Components use utilities,
  **never inline `style` objects or raw hex** — that's what keeps the UI themeable and responsive.
  **Colour has two layers and components may only name the second:** the per-theme *palette*
  (`themes/bundled/*.theme.json` → `--elevated`, `--hint`) is internal; the *semantic* tokens
  (`styles/colors.json` → `bg-container-elevated-bg`, `text-feedback-warning`) are the surface. Tints
  come from a four-step alpha scale as tokens, never Tailwind's `/40` modifier. `styles/COLOR.md` is
  the system, `styles/colorUsage.test.ts` the gate — Tailwind drops an unknown utility *silently*, so
  a token that isn't published renders as nothing.
- **Icons: `@remixicon/react` (Remix Icon; outline `Line` by default, solid `Fill` when the item is active/selected) only. UI primitives: shadcn/ui** (Radix), copied into
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

Every change that touches the app is verified by the **complete e2e suite once before it is considered
done**. During implementation, iterate with the affected spec
(`bun run e2e -- e2e/<feature>.spec.ts`) or `bun run e2e -- --last-failed`; do not rerun the full gate
after every edit.

`bun run e2e` is **fully self-contained and machine-adaptive**: it builds the web app once, then runs the
no-agent tests across isolated Playwright shard processes (automatic count = half the available CPUs,
clamped to 1–8). Every lane owns one serial worker + host and its own per-worktree-qualified ports, state,
HOME, pi-agent dir, fixture repo, and control files; reports merge into one result. Override with
`THINKRAIL_E2E_SHARDS=N` or `--shards=N` (1–16); use `bun run e2e:serial` for one-lane debugging. The
paths derive in `e2e/fixtures/paths.ts`, never touch `~/.thinkrail`, and parallel runs from different
worktrees never collide. Two complete invocations in the same worktree remain sequential. Focused
`e2e:full` runs preflight both modes and skips a mode with no selected tests; selecting nothing fails, while
an argument-free run and `--list` retain both phases. Cancellation in the no-agent, agent, and full runners
signals their complete child trees (POSIX snapshot; Windows tree-aware termination), then force-kills
survivors after a bounded grace; this does not describe the separate binary or desktop artifact runners. Each
lane seeds fixtures (`globalSetup`), drives the real web UI, then tears its host down and cleans up
(`globalTeardown`). Tests live in `e2e/` and
assert via `data-testid` / `data-status` hooks. Design: `e2e/SPEC.md`. The same suite also has
packaged CLI-binary and Electrobun-desktop host modes.

**Agent tests are tagged, not faked.** Specs that drive a real `pi` agent are tagged `@agent` (Playwright
`{ tag: "@agent" }`). `bun run e2e:agent` enables the dedicated real-Central mode: setup copies the user's
global Central extension into the lane's isolated HOME, gives the isolated `PI_CODING_AGENT_DIR` only a
`settings.json`, and requires `provider.status` plus `model.default` to prove the exact configured model
before a test starts. The web build alone preserves the caller environment; before Playwright and every
Central-mode host, the harness removes PI provider API/token variables plus Google and AWS ambient credential
sources. Central test execution must use the public `e2e:agent` or `e2e:full` runner (direct Playwright is
limited to `--list`) so the build finishes before that sanitization. It never copies `auth.json` or
`models.json`, and the host resolves only the read-only test Central CLI. Override the deterministic default
with `THINKRAIL_E2E_MODEL=<provider>/<modelId>`. Do not let an `@agent` test select a model — it would pin a
default mid-run. `bun run e2e` runs the fast **no-agent** suite; `bun run e2e:full` runs no-agent first,
then the isolated Central agent suite. There is **no fake agent** — agent coverage runs against a real
provider. The separate `bun run test:workflows` harness deliberately retains local PI-auth seeding in its
per-worker isolated agent directories.

**`bun run e2e:binary`** (after `bun run build:binary`) runs the no-agent suite against the **compiled
single-file binary** instead of the dev host (skipping the `@dev-seam` fake-login specs — those fakes live
only in the dev boot): the gate for the regression class that only exists inside the artifact (e.g. pi's
dynamic imports resolving from `node_modules`), alongside the targeted probes in `smoke:binary`.

Separate from the browser suite: `bun run test:workflows` — the headless **workflow-skill suite**
(`e2e/workflows/`, own Playwright config, no browser/webServer; drives a real in-process pi agent
through the workflow skills). On-demand only: needs pi auth and spends real provider tokens — never a
commit/CI gate. Design: `e2e/workflows/SPEC.md`.

Fast gates (also the husky pre-commit): `bun run check:deps` (dependency pins) +
`bun run check:boundaries` (workspace dependency/import edges) + `bun run check:seams`
(the pi binary-seam canary — fails when a pi bump adds a bundler-opaque dynamic import that
`registerBundledRuntime` doesn't statically register) + `bun run lint` (biome) + `bun run typecheck`. Unit tests:
`bun run test` (the repo-root `scripts/` tests, then bun test per workspace via turbo — root scripts live
outside every workspace, so turbo cannot see them). One-time setup for a fresh machine: `bunx playwright install chromium`.

`bun run check:spec-surface` holds specs tagged `public-surface-checked` to their barrels: the public-surface
bullet must remain a bare list of backticked identifiers, and the TypeScript compiler's effective export
names must match it exactly across type-only, default/CommonJS-assignment, named, namespace, and transitive re-exports. A tagged
missing/prose surface, missing barrel, or unresolved re-export fails rather than becoming a skip. Untagged
specs remain descriptive; `--list-skipped` names them and why. The contract lives in `module-repo-scripts`.
The check runs in CI, not in the pre-commit hook.

## Handoff hygiene (before any commit, PR, or "done" summary)

Green gates are necessary, not sufficient — they can't see duplication, suppressions, or leftovers.
Before committing, opening/updating a PR, or declaring work done, re-read the full diff
(`git diff origin/main...HEAD` + working tree) as a reviewer would, and enforce:

- **No silent suppressions.** Never add `biome-ignore` / `@ts-expect-error` / `@ts-ignore` /
  `eslint-disable` / `as any` to make a gate pass. A lint/type error is a design signal: first ask
  whether the state, dependency, or structure it flags should exist at all — prefer deleting the cause
  over guarding it. If a suppression still seems genuinely right, stop and get user sign-off first; an
  unrequested suppression must never be discovered in review. Audit before handoff:
  `git diff origin/main...HEAD -U0 | rg '^\+.*(biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error|as any)'`
  → must come back empty.
- **No comment creep.** New comments in the diff are suspect by default (see the near-zero rule under
  *Spec graph*): a rationale paragraph added as a comment gets moved to the owning `SPEC.md` before
  handoff. Audit: `git diff origin/main...HEAD -U0 | rg '^\+\s*(//|/\*|\*)'` → every hit is a lint
  directive or a one-line hazard note, nothing else.
- **No duplicated derivations.** The same nontrivial expression/lookup landing in 2+ places means
  centralize it first. Web specifics: derived state belongs in store selectors
  (`apps/web/src/store/selectors.ts`), components never inline multi-step derivations from store state;
  store writes that always travel together are one atomic store action, not two calls at each call site.
- **Refactor sweep.** When a change replaces a pattern or state model, `rg` the repo for the old
  pattern and migrate every occurrence — or name the survivors and why in the handoff. Never leave call
  sites half-migrated.
- **End analyses with an offer.** When the user questions your recent work and your analysis concludes a
  change is warranted, finish with the concrete change + "apply?" (or just apply it if it's within the
  approved scope) — never with prose that makes the user say "do the cleanup then please".
- **UI-visible changes:** offer before/after screenshots alongside the PR without being asked.

## Stack

Bun + Turbo monorepo · TypeScript (strict) · React 19 + Zustand + Tailwind v4 (web) · in-process `pi`
via `@earendil-works/pi-coding-agent` (Node ≥ 22.19). On-disk app state under `~/.thinkrail`.

- **Dependencies pin exact versions — no ranges** (`^`/`~`/`.x`/`*`). Cross-cutting deps are pinned once in
  the root `workspaces.catalog` and referenced via `catalog:`. Enforced by `bun run check:deps`
  (`scripts/check-catalog.ts`, in pre-commit + CI); `peerDependencies` + local protocols are exempt. See
  `architecture.md` Decision #10 for the why.
