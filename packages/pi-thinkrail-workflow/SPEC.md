---
id: module-thinkrail-workflow
type: module-design
status: active
title: pi-thinkrail-workflow — pi extension shipping the workflow system
parent: architecture
depends-on: [module-spec-graph]
tags: [pi-extension, workflow, skill, workflow-system]
references: [module-workflow-tests]
---

## Responsibility

`pi-thinkrail-workflow` is a pi extension that ships ThinkRail's **workflow system** — skills that
codify how the agent should *run a piece of work*. (Contrast: `pi-spec-graph` defines what the spec
model *is*; `pi-visualize` is a rendering tool.) It contributes exactly two things, wired by the
`package.json` pi manifest (`pi: { extensions: ["./index.ts"], skills: ["./skills"] }`):

- **`index.ts`** — an `ExtensionFactory` registering one always-on `before_agent_start` rule that
  points every new piece of work at the root router skill (`choosing-a-workflow`).
- **`skills/`** — the workflow skill family: the root router, `brainstorming`, and the
  **setting-up-a-project trio** — the `setting-up-a-project` **dispatcher** routing to
  `starting-a-new-project` (inception interview → `goal-and-requirements.md`) or
  `importing-a-codebase` (existing codebase → first spec graph) — plus the authoring checklist. The system's design — concept model, skill roles, meta-rules, the
  family table, per-skill rationale — lives in [[submodule-workflow-skills]].

The package grows by adding `skills/<name>/` sub-modules (a new tool would go under a `tools/`
sub-module if one is ever needed); nothing about the layout — or the system's shape — changes to add
the next skill (meta-rule 12 in [[submodule-workflow-skills]]).

## Knowledge delivery

Same mechanism as `pi-spec-graph` ([[module-spec-graph]]): each workflow lives in its own skill,
auto-discovered via the `pi.skills` manifest / `additionalSkillPaths`. The `before_agent_start` rule
mirrors `pi-spec-graph`'s `SPEC_RULE`: short and byte-stable so it rides every run without churning
provider prompt-caching, and a pointer, not a restatement — routing rules live once in the router
skill; each workflow's steps live once in its own skill. The setting-up-a-project family carries no
rule of its own — the root router routes onboarding to the dispatcher (whose `description` also
self-triggers), and in-app the Welcome screen's "Set up project" card seeds the
`/skill:setting-up-a-project` command — pi's skill-command syntax that **forces** the dispatcher to load
rather than relying on description-matching (see [[module-web]]).

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
- **The authoring checklist ships with the product — deliberately.** `writing-workflow-skills` is
  dev-facing (it edits this package), yet it stages into every ThinkRail project like the rest of the
  family: excluding one skill would complicate the staging path for little gain, and its trigger is
  narrow. The skill body carries the corresponding workspace guard — when `packages/pi-thinkrail-workflow`
  is not in the workspace (a ThinkRail-managed project, where these skills are a read-only staged
  cache), it says so in one line and stops; the family is extended only at its source, the thinkrail
  repo.

## thinkrail integration

`packages/server/src/agent/extensions.ts` adds this package the same way as `pi-spec-graph`:
`require.resolve("pi-thinkrail-workflow/index.ts")` on `additionalExtensionPaths`, its `skills/` dir on
`additionalSkillPaths`.

## Testing

`index.test.ts` pins the one runtime behavior this package has: the factory registers a
`before_agent_start` handler that appends `WORKFLOW_RULE` after the existing system prompt, preserving
it verbatim. The rule's *wording* is prose, not contract, and stays unpinned.

Skill behavior is tested headlessly by the **workflow-test harness** — design, verdict model,
suites, and coverage live in [[module-workflow-tests]] (`bun run test:workflows`; on-demand — needs
pi auth, spends real tokens, never a commit/CI gate). Per-skill observation status lives in the
family table ([[submodule-workflow-skills]]), which also records the routing suite's one open
finding (questions bypass the root router). Slice 3 (worker flows end-to-end) is partially landed:
`importing-a-codebase` runs in the harness's importing suite (adoption + regression scenarios, added
with the doc-adoption work). Remaining follow-up — scenario definitions only, no new machinery:
`starting-a-new-project` / `brainstorming` full runs via the user simulator (design record:
[[module-workflow-tests]]).

The import branch is additionally covered **through the app** by a tagged `@agent` browser e2e
(`e2e/setting-up-a-project.live.spec.ts`): it turns a workspace worktree into a code-only project,
drives the Welcome card's exact `/skill:setting-up-a-project` command, and asserts the flow drafts
`goal-and-requirements.md` (rendered in the Specs rail) — proving the button's `/skill:` seed drives
the flow on the `session.prompt` path, which no headless scenario exercises.

## Non-goals

- A vanilla-pi-portable workflow package — would require replacing `ask_user_question` with a
  lowest-common-denominator question mechanism; not worth it for a thinkrail-only host feature (see
  Boundary).
- Any runtime/engine layer for workflows — see "no runtime machinery" in [[submodule-workflow-skills]].
- Reimplementing old thinkrail's `claude-plugin` **ticket/board engineering workflow** (its
  ticket-orchestrator, ticket-implement, bug-fix, spec-review, etc. skills — used by the thinkrail team
  to build thinkrail itself). That is dev-tooling for a different, ticket-based product with no board or
  ticket system to run against here. Porting an individual *product-facing* skill remains fine — that is
  how `setting-up-a-project` arrived ([[submodule-workflow-skills]]).
