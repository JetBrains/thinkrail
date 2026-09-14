# ThinkRail

A ThinkRail-branded desktop-and-mobile client for the `pi` coding agent. The app is a thin host that
runs `pi` and bridges it to a rich UI; `pi` owns models, skills, compaction, cost, and session state.

## Read context proportionally

- Use `goal-and-requirements.md` for product scope and V1/V2 decisions.
- Use `architecture.md` for system topology, cross-module decisions, and repo-wide invariants.
- Read the owning `SPEC.md` when work is governed by or may alter a module boundary, contract,
  invariant, documented behavior, or architecture decision.
- Localized work does not require unrelated specs or a full repository map.

## Module structure and boundaries

Clear, fractal module boundaries are a top-priority requirement:

- Every package and meaningful directory-level sub-module has a `SPEC.md` stating its responsibility,
  public surface, allowed dependencies, and forbidden reaches.
- A sub-module exposes an `index.ts` barrel as its only public surface; siblings import through the
  barrel, never internals. Per-file imports remain only where a barrel would defeat code-splitting or a
  library convention, such as `apps/web/src/panels` and `components/ui`.
- Dependency edges between sibling sub-modules live in the parent module's `SPEC.md`, not each leaf.
- A change that moves or blurs a boundary updates the owning spec first. Cover public surfaces and
  boundary rules with tests where practical, but do not manufacture coverage for a localized change.

## Engine and architecture

- Run `pi` in-process through `@earendil-works/pi-coding-agent` (`createAgentSession`), never as a
  subprocess and never through a second agent runtime. Fatal provider/agent faults can take down the
  host; that lack of crash isolation is accepted.
- The three rings are engine host (`packages/server` + `packages/shared`), typed wire
  (`packages/contracts`), and independently shippable UI (`apps/web`). `apps/cli` and `apps/desktop`
  are thin launchers over the same host.
- Use only the `@earendil-works/*` package scope. `@mariozechner/*` is deprecated.

## Repo-wide invariants

- `apps/web` depends on `packages/contracts` only, never `server` or `shared`.
- Never value-import `pi` into browser-bundled code. Import types only from the `pi-ai` /
  `pi-agent-core` package roots; `@earendil-works/pi-coding-agent` is server-only.
- One id model: UI tab id versus `session.sessionId`; there is no separate pi UUID.
- `pi` owns state. The host exposes what pi reports rather than recomputing cost, stats, or state.
- Streaming semantics: `text_delta` / `thinking_delta` append;
  `tool_execution_update.partialResult` replaces.
- `prompt()` throws while a session is streaming; use `steer()` / `followUp()`. Forward errors through
  the event stream and thrown method result rather than treating them as a crash signal.
- Automatic work ends at `agent_settled`, never `agent_end`; retries, compaction, recovery, or queued
  continuations may follow an attempt-level `agent_end`.
- UI panels are layout-agnostic; the shell arranges them.
- The transport host endpoint is a parameter, defaulting to same-origin; `server.welcome` carries the
  protocol version.

### Web UI context

For web UI work, read `apps/web/SPEC.md` and the owning sub-module spec. Styling uses Tailwind v4
utilities mapped to generated semantic CSS-var tokens: never inline style objects, raw hex, internal
palette names, or unknown token utilities. Read `apps/web/src/styles/COLOR.md` for color work and
`apps/web/src/styles/SPACING.md` for spacing work. Use `@remixicon/react` icons (Line by default, Fill
when active) and owned shadcn/Radix primitives from `apps/web/src/components/ui/`; `cn()` lives in
`apps/web/src/lib/utils.ts`.

For conversation rendering or tool presentation, read `apps/web/src/chat/SPEC.md`. Presentational
renderers remain props-driven; only `ChatView` integrates store and transport. A server capability and
its UI renderer are joined by tool name through `registerToolRenderer`; unregistered tools use the
default renderer.

## Specs and comments

Specs are the durable home for intent, decisions, invariants, trade-offs, and post-mortems. Keep them
concise and avoid restating code or another spec. Comments are near-zero: lint/type directives and a
rare one-line hazard note are acceptable; rationale and narrative belong in the owning spec.

## Verification

Local tests use disposable fixtures and have no production access. Run affected tests, fix failures
caused by the requested change, and rerun them without asking for approval at each step.

- Iterate with the smallest relevant unit or focused E2E target.
- For shipped app behavior or integration changes, run the complete browser E2E suite once after the
  combined implementation and before final handoff or PR — not once per TODO item or commit. Use
  `bun run e2e:full` when the change touches real agent behavior; otherwise use `bun run e2e`.
- Documentation/spec-only changes and test-harness-only changes use targeted checks unless they can
  affect the shipped runtime.
- Fast gates: `bun run check:deps`, `bun run check:boundaries`, `bun run check:seams`, `bun run lint`,
  and `bun run typecheck`. Unit tests are `bun run test`; `bun run check:spec-surface` validates enrolled
  spec/barrel public surfaces.
- `bun run test:workflows` is on-demand: it uses real provider tokens and is not a commit/CI gate.
- Binary and desktop artifact modes have separate gates; use them when changing those artifacts.

All runner modes, isolation guarantees, credential handling, cancellation behavior, and debugging
commands live in `e2e/SPEC.md`; workflow harness details live in `e2e/workflows/SPEC.md`.

## Handoff hygiene

Green gates are necessary but not sufficient:

- Before a local handoff, review the task-scoped working tree and commits. Before opening or updating a
  PR, review the full branch diff against its base plus the working tree.
- For nontrivial implementation, do a subtraction pass: remove avoidable abstractions, state owners,
  dependencies, compatibility layers, and fallbacks. Report material removals and justify layers that
  remain; do not add ceremony for a localized edit.
- Never add `biome-ignore`, `@ts-expect-error`, `@ts-ignore`, `eslint-disable`, or `as any` merely to make
  a gate pass. Treat the error as a design signal. If a suppression is genuinely required, get explicit
  user approval first.
- Audit newly added comments and suppressions in the same diff range being reviewed. Do not let prior,
  unrelated branch history contaminate a task-local handoff.
- Centralize duplicated nontrivial derivations. In the web app, derived store state belongs in
  selectors and writes that always travel together belong in one atomic action.
- When replacing a pattern or state model, search for every old occurrence and migrate it, or name the
  intentional survivors.
- Apply safe cleanup that is inside the approved scope. Ask only for destructive, out-of-scope, or
  product-level decisions.
- Use the `shipping-a-pr` skill for PR lifecycle work, including screenshot expectations and PR
  templates. When creating an issue programmatically, reproduce the selected issue template and pass
  its frontmatter labels.

## Stack

Bun + Turbo monorepo · TypeScript strict · React 19 + Zustand + Tailwind v4 · in-process `pi`
(Node >= 22.19). App state lives under `~/.thinkrail`.

Dependencies pin exact versions. Cross-cutting dependencies are pinned once in the root
`workspaces.catalog` and referenced through `catalog:`; peer dependencies and local protocols are the
only exemptions. `architecture.md` Decision #10 owns the rationale.
