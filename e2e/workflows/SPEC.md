---
id: module-workflow-tests
type: module-design
status: active
title: e2e/workflows — headless workflow-test harness + scenarios
parent: architecture
references: [module-thinkrail-workflow, submodule-server-agent, submodule-workflow-skills, module-server]
tags: [testing, workflow-system, pi]
---

## Responsibility

The headless workflow-test suite: drives a **real in-process pi agent** through the workflow skills
([[module-thinkrail-workflow]]) with **no browser and no HTTP host**, and decides pass/fail with a
strict verdict model. Run on demand via `bun run test:workflows` (own Playwright config,
`playwright.workflows.config.ts` — no `webServer`; shares the browser suite's global setup for the
isolated `PI_CODING_AGENT_DIR` + pinned model). Needs pi auth and spends real provider tokens — never
part of `bun run test`, pre-commit, CI gates, or the browser `e2e`/`e2e:agent` scripts (the main
config `testIgnore`s this directory).

**Verdict model (the invariant everything here serves): an LLM never decides *pass*.**
- *Binding:* deterministic checks + signals over the captured event log and workspace — a skill load
  is the `read` of its `SKILL.md`; artifacts are asserted on disk; forbidden tools/paths are absent.
- *Input/diagnosis only:* the persona responder and user simulator (cheap LLM) generate user-side
  input; the watchdog's on-track assessment only aborts-with-diagnosis (a test then fails via its
  unfired stop-signal); the judge grades a per-scenario rubric **advisorily** (warn + run log, never
  a test failure).

## Harness (`harness/`, barrel `index.ts` — the only import surface for spec files)

Adding a workflow test = one `defineScenario` call: `{ name, skill, workspace, preset?, entry?,
user?, dialog?, stopWhen?, forbid?, watchdog?, expect, judge?, record? }`.

- `session` — lifecycle over the production `@thinkrail/server/agent` barrel (`createSession` etc.);
  sets `PI_CODING_AGENT_DIR` before the pi runtime initializes (`env.ts`, imported first); an abort
  from a stop-signal is an expected outcome — but only a *requested* one (`promptTurn` swallows an
  abort-shaped error solely when the caller confirms a signal/budget asked for it; an unrequested
  "aborted" is a provider/network crash and rethrows). Never `setModel`.
- `events` — `EventLog`: one process-wide `setSessionPublisher` subscriber buffers every session's
  events unconditionally (capture can't miss early events); queries + `waitFor` + compact transcript
  rendering; deltas APPEND, `partialResult` REPLACES.
- `workspace` — throwaway git cwds under the e2e data dir (`empty` / `code-only` / `specced` /
  custom seed).
- `dialog` — answers `ask_user_question` rounds through the **production `answerQuestion` bridge**,
  walking a ladder: script matchers → persona (validated; malformed → next rung) → deterministic
  fallback (`skip` / `pickRecommended`). An unscripted interview can never hang a run, and neither
  can a *throwing* script (scenario-author code): it degrades straight to the deterministic fallback
  with the error recorded on the round — never an unhandled rejection.
- `presets` — mid-flow entry: artifact presets (workflow-native — the task-spec is the workflow's
  spine) and transcript fixtures (`SessionManager.open` via the server's `setSessionManagerFactory`
  seam; a fixture = `session.jsonl` + `workspace/` snapshot with recorded-cwd rewritten in a temp
  copy). Fixtures are born via record mode: `THINKRAIL_WORKFLOW_RECORD=1` + a scenario's `record`
  name → `fixtures/<name>/`. **Fixture markdown is masked at rest** — every `*.md` in a snapshot is
  stored as `*.md.test` (masked on record, unmasked on replay into the throwaway cwd) so fixture
  specs (`id: acme-root`, …) never appear in the host repo's own spec graph: spec discovery globs
  `*.md` with only a hardcoded dir ignore-list, so unmasked fixtures would surface in the product's
  Specs rail and every `spec_grep`. *Rejected alternative:* extending `pi-spec-graph`'s ignore-list —
  ignoring `e2e/` would swallow this real spec, a name-based "fixtures" ignore would change a
  portable package's semantics for a repo-local test concern, and masking also shields every other
  `*.md` scanner, not just spec discovery.
- `signals` — predicates over the log; `stopWhen` (pass → abort, the main cost control) and `forbid`
  (fail → abort immediately).
- `watchdog` — deterministic budget tripwires (turns / tool calls / wall time, defaults on every
  scenario) + optional between-turns on-track assessment.
- `userSim` — the simulated human (shares the scenario's persona brief with `dialog`): composes the
  opening and follow-up chat messages until a signal, budget, or `DONE`.
- `checks` / `judge` / `runlog` — binding verdicts; the advisory rubric grader; one JSON line per run
  appended to the **gitignored** `e2e/.workflow-runs.jsonl` (outside the wiped e2e data dir — local
  evidence by decision; rule 14's suspension rationale lives in [[submodule-workflow-skills]]). A run
  that throws before its verdict records `crashed` + a failed deterministic verdict — the log never
  claims a pass whose checks never ran (`THINKRAIL_WORKFLOW_RUNLOG` redirects the file so unit tests
  can assert on records without polluting the local evidence).
- `scenario` — orchestration (seed → presets → start → attach → conversation loop → verdicts → run
  record) with teardown in `finally` — covering the earliest steps too: the transcript-fixture factory
  swap and `startSession` live inside the guarded region, so a throw there still restores the
  process-wide seam; `workflowTest` registers a scenario as a Playwright test (tagged `@agent`).

Dependency direction is one-way: `scenario` → everything; `dialog`/`signals`/`userSim`/`watchdog` →
`events`/`session`; `checks`/`judge` read the frozen log; only `session`/`presets`/`dialog`/`judge`/
`userSim`/`watchdog` touch the server barrel (sessions, the answer bridge, `completeOnce`).

## Boundary

- **Allowed deps:** `@thinkrail/server/agent` (the subpath export added for this harness — recorded
  in [[module-server]]; the barrel's behavior is [[submodule-server-agent]]),
  `@earendil-works/pi-coding-agent` (`SessionManager`),
  `@thinkrail/contracts` (types), `@playwright/test`, `../fixtures/paths`, Node.
- **Forbidden:** `@thinkrail/server`'s root export (evaluates the Bun-only `host`), `apps/*`, any
  browser/page fixture, model selection (`setModel` would persist a default into the shared isolated
  agent dir mid-run).

## Suites

- `harness.unit.spec.ts` — the pure parts (parsers, predicates, checks, budget tripwires) against
  synthetic logs; no live agent, no auth needed.
- `routing.live.spec.ts` — the routing suite (slice 2): one scenario per row of the two routers'
  classification tables — the root router reached naturally via the always-on rule; the dispatcher
  force-loaded via the app's exact `/skill:` seed (which injects the skill content, so no read of
  its own SKILL.md is expected). Pass = the routed worker's skill-load signal (or, for the
  no-work rows, no worker load + a grounded outcome). The pure-question row's missing declaration
  is a recorded gap — [[submodule-workflow-skills]] § Current limitations & gaps.
- `smoke.live.spec.ts` — the infra-proving live scenarios: a mid-flow `brainstorming` round-trip
  (artifact preset + persona answer + user simulator + on-disk decision), and transcript continuation
  (reopened fixture recalls mid-flow state).
- Follow-up (scenario definitions only): worker flows end-to-end (slice 3) — tracked in
  [[module-thinkrail-workflow]] § Testing.
