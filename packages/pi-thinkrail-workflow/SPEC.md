---
id: module-thinkrail-workflow
type: module-design
status: active
title: pi-thinkrail-workflow — brainstorming skill (seed of a workflow-skill family)
parent: architecture
depends-on: [module-spec-graph]
tags: [pi-extension, workflow, brainstorming, skill]
---

## Responsibility

`pi-thinkrail-workflow` is a pi extension that ships **process/workflow skills** — skills that codify how
the agent should *run a piece of work*, as opposed to `pi-spec-graph` (what the spec model is) or
`pi-visualize` (a rendering tool). V1 ships exactly one skill, **`brainstorming`**: it turns a raw feature
request into a validated design — captured as a spec-graph `task-spec` — before any implementation starts,
mirroring the discipline this repo already applies to itself (draft → active specs, "the spec leads the
code").

This package is the seed of a growing family. Future workflow skills (e.g. a thinkrail-implement or
bug-fix equivalent) are added as sibling `skills/<name>/` sub-modules; a new tool goes under a `tools/`
sub-module if one is ever needed. Nothing about the layout changes to add the next skill.

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent` (**types only** — `ExtensionAPI`/`ExtensionFactory`),
  as a `peerDependency`. No `typebox` in v1: this package registers no custom tool, only a
  `before_agent_start` rule and skill content.
- **Forbidden:** any `@thinkrail-pi/*` package, `apps/web`, `packages/server` internals — reached only by
  tool *name* (`ask_user_question`, `spec_*`), never by import.
- **Not portable, and honest about it.** Unlike `pi-spec-graph` and `pi-visualize`, this package's skill
  content assumes the host's `ask_user_question` tool (`packages/server/src/agent/askUserQuestion.ts`) is
  present in the session — that tool exists only in thinkrail-pi. This package does not claim to run
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
    brainstorming/SKILL.md   — the brainstorming workflow (v1's only skill)
  package.json                — pi: { extensions: ["./index.ts"], skills: ["./skills"] }
```

## Knowledge delivery

Same mechanism as `pi-spec-graph` ([[module-spec-graph]]): the workflow itself lives in the skill,
auto-discovered via the `pi.skills` manifest / `additionalSkillPaths`. A short, byte-stable
`before_agent_start` rule (mirroring `pi-spec-graph`'s `SPEC_RULE`) nudges the agent toward the
brainstorming skill before creative/feature work, the same way `pi-spec-graph`'s rule nudges it toward
spec tools before exploring or planning. The rule is a pointer, not a restatement — the workflow's actual
steps live once, in the skill.

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

## Error handling

- No UI (headless host) → `ask_user_question` reports unavailable; the skill states its assumptions
  explicitly in the `task-spec` rather than blocking.
- User skips/declines questions → proceed on labeled, explicitly-marked-unconfirmed assumptions.
- Zero-spec project → still works: a `task-spec` only needs frontmatter `id` + `type`, no pre-existing
  graph required.

## thinkrail integration

`packages/server/src/agent/extensions.ts` adds this package the same way as `pi-spec-graph`:
`require.resolve("pi-thinkrail-workflow/index.ts")` on `additionalExtensionPaths`, its `skills/` dir on
`additionalSkillPaths`.

## Testing

No dedicated unit test for `index.ts` (mirrors `pi-spec-graph`'s own `index.ts`, which has none either —
a rule string and tool registration aren't meaningfully unit-testable). Verification is a manual smoke
test: a real feature request triggers the skill, a `task-spec` appears, questions render as an
`ask_user_question` card, an approved design gets promoted into a module `SPEC.md`. A tagged `@agent` e2e
spec is a reasonable follow-up once the skill's wording stabilizes — not required for v1.

## Non-goals

- A vanilla-pi-portable brainstorming skill (would require replacing `ask_user_question` with a
  lowest-common-denominator question mechanism — not worth it for a thinkrail-pi-only host feature).
- Building out the rest of the skill family (thinkrail-implement, bug-fix, etc.) now — this spec only covers
  `brainstorming`; the structure is ready for them, they are not designed here.
- A Claude Code / dev-tooling equivalent of old thinkrail's `claude-plugin` — out of scope per this spec's
  brief (product feature only).
