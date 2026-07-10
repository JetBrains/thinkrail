---
id: module-thinkrail-workflow
type: module-design
status: active
title: pi-thinkrail-workflow — workflow skills (brainstorming, project setup)
parent: architecture
depends-on: [module-spec-graph]
tags: [pi-extension, workflow, brainstorming, project-setup, skill]
---

## Responsibility

`pi-thinkrail-workflow` is a pi extension that ships **process/workflow skills** — skills that codify how
the agent should *run a piece of work*, as opposed to `pi-spec-graph` (what the spec model is) or
`pi-visualize` (a rendering tool). It ships a **brainstorming** skill and a **project-setup** family:

- **`brainstorming`** — turns a raw feature request into a validated design, captured as a spec-graph
  `task-spec`, before any implementation starts, mirroring the discipline this repo already applies to
  itself (draft → active specs, "the spec leads the code").
- **project setup (three skills)** — onboarding a project into a spec graph. **`project-setup`** is a tiny
  **dispatcher**: it detects whether the workspace is a brand-new/empty project or an existing codebase
  with no specs, then routes to one of two flows. **`project-new`** (the inception flow, distilled from old
  thinkrail's `claude-plugin` `new-project` skill — working-model inference, personal-vs-PRD routing,
  MVP-first elicitation, alternatives research, incremental save; the ticket/board hand-off and
  progress-tracker visualizations it had have no equivalent here and are dropped) turns a raw idea into
  `goal-and-requirements.md`. **`project-import`** (net-new) reverse-engineers the first spec graph of an
  existing codebase — `goal-and-requirements.md` + `architecture.md` + short per-module `SPEC.md` files —
  by reading the code and agent files (`AGENTS.md`/`CLAUDE.md`/`README`/manifests) and interviewing only
  for the intent the code can't reveal. All three enforce one bar: **short, honest, on-rails specs** (small
  enough to read, high-signal enough to keep an agent on track), and hand off to `brainstorming` for the
  features that follow. The single UI entry point is `apps/web`'s "Set up project" card, which seeds the
  `/skill:project-setup` command — pi's skill-command syntax that **forces** the dispatcher to load
  (see [[module-web]]).

This package is the seed of a growing family. Future workflow skills (e.g. a thinkrail-implement or
bug-fix equivalent) are added as sibling `skills/<name>/` sub-modules; a new tool goes under a `tools/`
sub-module if one is ever needed. Nothing about the layout changes to add the next skill.

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent` (**types only** — `ExtensionAPI`/`ExtensionFactory`),
  as a `peerDependency`. No `typebox` in v1: this package registers no custom tool, only a
  `before_agent_start` rule and skill content.
- **Forbidden:** any `@thinkrail/*` package, `apps/web`, `packages/server` internals — reached only by
  tool *name* (`ask_user_question`, `spec_*`), never by import.
- **Not portable, and honest about it.** Unlike `pi-spec-graph` and `pi-visualize`, this package's skill
  content assumes the host's `ask_user_question` tool (`packages/server/src/agent/askUserQuestion.ts`) is
  present in the session — that tool exists only in thinkrail. This package does not claim to run
  under vanilla `pi`; it is a workspace-internal module, not a portable capability. It stays its own
  package rather than folding into `packages/server` anyway, for the same reason `packages/shared` isn't
  folded into `server`: non-portable is not the same as infra-runtime-coupled. A `SKILL.md` has no runtime
  coupling to the WS/session layer — it only needs a path handed to `additionalSkillPaths`.

## Structure

```
pi-thinkrail-workflow/
  SPEC.md
  index.ts                   — ExtensionFactory: registers the before_agent_start rule below
  skills/
    brainstorming/SKILL.md    — the brainstorming workflow
    project-setup/SKILL.md    — dispatcher: detect new vs existing, route to one of the two below
    project-new/SKILL.md      — inception flow: empty project → goal-and-requirements.md (interview)
    project-import/SKILL.md   — import flow: existing codebase → first spec graph (derive + minimal interview)
  package.json                — pi: { extensions: ["./index.ts"], skills: ["./skills"] }
```

## Knowledge delivery

Same mechanism as `pi-spec-graph` ([[module-spec-graph]]): each workflow lives in its own skill,
auto-discovered via the `pi.skills` manifest / `additionalSkillPaths`. A short, byte-stable
`before_agent_start` rule (mirroring `pi-spec-graph`'s `SPEC_RULE`) nudges the agent toward the
brainstorming skill before creative/feature work, the same way `pi-spec-graph`'s rule nudges it toward
spec tools before exploring or planning. The rule is a pointer, not a restatement — the workflow's actual
steps live once, in the skill. The project-setup family carries no rule of its own — it's a narrower
trigger (onboarding a project) the agent finds via the dispatcher's `description`, and is reached in-app
via the "Set up project" card's `/skill:project-setup` command seed (force-loading the dispatcher rather
than relying on description-matching). `project-new` / `project-import` describe themselves as the
dispatcher's two branches, so the dispatcher is the clean front door while each stays directly reachable
when the situation is unambiguous — per the "nothing about the layout changes to add the next skill" note
above.

## The brainstorming skill (outline)

Full wording is authored in `skills/brainstorming/SKILL.md`; this is the shape it must follow:

1. **Orient** via `spec_grep`/`spec_get`/`spec_graph` first (per the spec-graph skill), code second.
2. **Scope check** — flag decomposition before going deep if the request spans independent features.
3. **Open a `task-spec`** immediately via `spec_create` — this is the one live design artifact; no
   separate doc format.
4. **Clarify** via `ask_user_question`, batched to its own constraints (≤4 questions/call, "don't chain
   calls back-to-back" — a deliberate deviation from one-question-at-a-time interactive styles): batch
   related questions into a round, open a new round only when answers surface genuinely new questions.
5. **Propose 2-3 approaches** with trade-offs, written into the `task-spec`; may be surfaced as an
   `ask_user_question` single-select (each approach as an option, its trade-off as the description).
6. **Present the design in sections**, updating the `task-spec` live, confirming as it goes.
7. **Self-review** — placeholder/consistency/scope/ambiguity check, plus `spec_validate`.
8. **Promote** settled decisions into the touched module's `SPEC.md` (`spec_create`/`spec_update`,
   draft → active).
9. **Final user review**, then **implement directly against the finalized spec** — pi has no separate
   plan-writing skill, so the spec (or its own checklist) is the plan. Keep it honest as code lands; per
   `task-spec`'s own definition ([[module-spec-graph]]), retire it once **the work itself** lands, not
   merely once the design is promoted — it stays as the working record through implementation.

## The project-setup skills (outline)

Full wording lives in the three `skills/project-*/SKILL.md` files; the dependency edge between them is
the dispatcher → flow handoff. The single in-app trigger is `apps/web`'s "Set up project" seed prompt.

- **`project-setup` (dispatcher).** Tiny by design. Detect (spec tools + a look at the workspace) →
  route: **already-specced** → don't redo, offer review/extend or point at `brainstorming`, stop; **empty
  repo** → follow `project-new`; **real source, no specs** → follow `project-import`. Restates the
  short/honest/on-rails bar all flows share, nothing more.

- **`project-new` (inception).** Distilled from old thinkrail's `claude-plugin` `new-project` skill, with
  its tool calls remapped to this environment (`spec_save` → `spec_create`/`edit`/`spec_update`,
  `AskUserQuestion` → `ask_user_question`, `WebSearch`/`WebFetch` → `web_search`/`fetch_content`) and its
  board/ticket + progress-tracker machinery dropped (no equivalent here). Shape: infer a working model from
  the request (never re-ask); fast-path a pre-filled brief; infer-then-confirm Overview + Problem; route
  Personal vs. PRD; elicit branch sections (each v1 feature justified against a Goal/Success condition);
  always offer alternatives research; review; save incrementally (`spec_create` once, `edit` per section,
  `spec_update` to `done`). Kept far leaner than the original port — the working method survives, the
  step-by-step bulk does not.

- **`project-import` (import, net-new).** Read first, ask last. Survey the repo — agent files
  (`AGENTS.md`/`CLAUDE.md`/`.cursor`/copilot) first, then docs, manifests, layout, code — and build a
  working model (what/domain/stack/modules+edges/invariants/decisions). Interview **only** the gaps the
  code can't answer, batched via `ask_user_question`; skip the interview entirely if the files answered
  everything. Draft the graph top-down — `goal-and-requirements.md` → `architecture.md` → one short
  `SPEC.md` per genuine module (responsibility + boundary; sibling edges live in the parent's SPEC), all
  `status: draft`, wired by `parent`/`depends-on` on real code edges. `spec_validate`, tell the user to
  review in Changes (nothing merges until they approve), hand off to `brainstorming`.

## Error handling

- No UI (headless host) → `ask_user_question` reports unavailable; `brainstorming` states its assumptions
  explicitly in the `task-spec` rather than blocking; the project-setup flows do the same in the specs
  they draft (`project-import` marks each inferred-but-unconfirmed spec `draft` with a one-line note).
- User skips/declines questions → proceed on labeled, explicitly-marked-unconfirmed assumptions.
- Zero-spec project → still works: a `task-spec` (or a fresh `goal-and-requirements.md`) only needs
  frontmatter `id` + `type`, no pre-existing graph required.

## thinkrail integration

`packages/server/src/agent/extensions.ts` adds this package the same way as `pi-spec-graph`:
`require.resolve("pi-thinkrail-workflow/index.ts")` on `additionalExtensionPaths`, its `skills/` dir on
`additionalSkillPaths`.

## Testing

No dedicated unit test for `index.ts` (mirrors `pi-spec-graph`'s own `index.ts`, which has none either —
a rule string and tool registration aren't meaningfully unit-testable). Verification is a manual smoke
test per skill: for `brainstorming`, a real feature request triggers the skill, a `task-spec` appears,
questions render as an `ask_user_question` card, an approved design gets promoted into a module `SPEC.md`.
For project setup, exercise the routing: a fresh idea in an **empty** workspace routes to `project-new`
and `goal-and-requirements.md` grows section by section to `done`; a **code-only** repo routes to
`project-import`, which mines agent files, interviews only for gaps, and drafts a short spec graph
(`goal-and-requirements.md` + `architecture.md` + module `SPEC.md`s, `status: draft`) on the workspace
branch. The **import branch is covered by a tagged `@agent` e2e** (`e2e/project-setup.live.spec.ts`): it
turns a workspace worktree into a code-only project (drops the fixture's seed specs, adds an `AGENTS.md` +
source), drives the button's `/skill:project-setup` command, and asserts the import flow drafts
`goal-and-requirements.md` (rendered in the Specs rail) — also proving the button's `/skill:` seed drives
the flow on the `session.prompt` path. A `project-new` `@agent` spec is a reasonable follow-up
(its heavy interview is harder to drive headlessly) — not required for v1.

## Non-goals

- A vanilla-pi-portable brainstorming or project-setup skill (would require replacing `ask_user_question`
  with a lowest-common-denominator question mechanism — not worth it for a thinkrail-only host
  feature).
- Building out the rest of the skill family (thinkrail-implement, bug-fix, etc.) now — this spec only
  covers `brainstorming` and the `project-setup` family (`project-setup`/`project-new`/`project-import`);
  the structure is ready for more, they are not designed here.
- Reimplementing old thinkrail's `claude-plugin` **ticket/board engineering workflow** (its
  ticket-orchestrator, ticket-implement, bug-fix, spec-review, etc. skills — used by the thinkrail team to
  build thinkrail itself) as a pi package. That is dev-tooling for a different, ticket-based product and
  has no board/ticket system to run against here. This does **not** rule out porting an individual
  *product-facing* skill like `new-project` → `project-setup`, adapted to this app's own tools, when it's
  useful to ThinkRail's own users.
