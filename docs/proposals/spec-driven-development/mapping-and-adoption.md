# Mapping onto the current architecture, adoption, and spec impact

Detail for the [architecture doc](../spec-driven-development-architecture.md). Module names refer to
today's specs: [architecture](../../../architecture.md), [spec-graph](../../../packages/spec-graph/SPEC.md),
[workflow family](../../../packages/pi-thinkrail-workflow/skills/SPEC.md),
[spec viewer reads](../../../packages/server/src/spec/SPEC.md), and the skill-alias / trust section of
`packages/server/src/agent/SPEC.md`.

## Module delta

| Module today | Now | After | Delta |
|---|---|---|---|
| `packages/spec-graph` (portable) | is-a-spec rule, `SpecIndex`, `spec_*` tools, skill, prompt rule | unchanged; additionally implements the provider contract (`detect` = durable spec present, `catalog` = nodes → artifacts) | keep + adapter |
| — | — | practice core: provider contract, discovery, catalog union, facets | **new portable package** (D7) |
| `server/spec` | `spec.graph`, `projectHasSpecs` → `project.hasSpecs` | `server/practice`: `workspace.artifacts` (all providers), `project.practice` (facts, status, selection, scope) | replace |
| `pi-thinkrail-workflow` | always-on rule → `choosing-a-workflow` → brainstorming / setup / shipping-a-pr | same mechanism; router step 0 reads the practice section; `brainstorming` only when ThinkRail governs; `setting-up-a-project` only when status is `none`; task-spec in `.thinkrail/context/` stays, scoped to ThinkRail's practice | change |
| `server/agent` | skill aliases, admission gate, project trust, MCP per-entry approval | unchanged gate; one more `before_agent_start` section; scope-driven skill and tool withholding | extend |
| `pi-todos` + plan review + `pr` body | the plan is always the TODO list | plan backend seam: native TODO / projected / mirrored through the provider, CAS-guarded; sidecar identity map | change |
| `contracts` | `SpecGraphSnapshot`, `project.hasSpecs` | practice and catalog DTOs, selection methods; `hasSpecs` removed; protocol version bump | change |
| `apps/web` Specs / Welcome / Plan | spec tree; "Set up project" card; TODO plan | Artifacts panel (native groups, facets, authority); status-driven Welcome card; Plan modes; working agreement; chat badge | change + new |
| `persistence` Project record | `trusted`, `acknowledgedSkills`, … | + selection, per-provider scope state, personal corrections | extend |
| `extension-api` / Decision 21 | web: tool renderers by tool name; server: pi factories + skill packages | + server `practiceProviders`; web artifact renderers by `(provider, kind)`, optional panel, plan source — **leading option, open question 6** | extend |
| `thinkrail-extensions/*` | `visualize` | + `openspec` provider (later) | new |
| `pi-dag` | unbundled (Decision 17) | unchanged; "durable run" mode is its named trigger | keep |
| goal / architecture docs | *Spec-first* principle; Specs and Workflows capabilities | principle reworded to "the project's practice, ThinkRail's by default"; new architecture decision | docs |

The real difference: today the spec system and the workflow *are* the system — one format, one router
target. After, they are one provider behind a contract the host reads, and the thing that chooses
between providers is a persisted project setting the agent is told about, not something it infers
each chat.

## Adoption

- **Existing ThinkRail-specced projects** detect as ThinkRail and behave identically: no migration, no
  file rewrites.
- **OpenSpec / Kiro / ADR projects** stop showing "No specs" and the Set-up card; they are browsable
  first, followed once the workflow delegates.
- **Empty or undocumented projects** keep today's flow (D2).
- **Mixed projects** resolve once and persist (D3).
- **Stored state**: nothing migrates; new Project fields default to "detect on next open". One wire
  protocol bump; `project.hasSpecs` disappears.
- **Vanilla pi users of `pi-spec-graph`** are unaffected; the practice core is a separate package.

## Candidate delivery cut (not decided)

1. **Recognize and show** — discovery with statuses, catalog with ThinkRail / Markdown / one framework
   reader, Artifacts panel, working agreement, persisted selection, Welcome. Routing unchanged.
   Validated with disposable fixtures, no tokens.
2. **Delegate the workflow** — router step 0, scoped skills and tools, Plan projection, delegation
   toggle. The routing suite (`bun run test:workflows`) becomes a gate.
3. **First native-ops integration** — OpenSpec as a `thinkrail-extensions/*` package: provider + skill +
   CLI ops + change view, conformance fixtures per declared version.

Saving and adapting guidance rides on existing mechanisms (portable skill dirs, `loader.reload()`) and
fits any slice; personal corrections need the host store from slice 1.

## Spec and doc impact on approval

- `goal-and-requirements.md`: the *Spec-first* principle and the Specs / Workflows capabilities.
- `architecture.md`: a new decision ("practices are linked, not imposed"); Decision 21's extension-point
  list; Decision 17's named trigger.
- `module-spec-graph`: the provider adapter; the glob exclusions stay for the ThinkRail provider.
- `module-thinkrail-workflow`, `submodule-workflow-skills`: router step 0, brainstorming scope, D8 on
  doc adoption, the "no runtime machinery" rule clarified as being about workflow *execution*.
- `submodule-server-spec` → `server/practice`; `contracts`; web panels, store and shell specs;
  `submodule-server-todos` (plan backend); `extension-api`.
- The proposal: framing, decisions 1–12, the rollout re-cut.
