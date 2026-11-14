# Isolation: user cases and the proposed scope model

Detail for the [architecture doc](../spec-driven-development-architecture.md), open questions 1–3.

The product owner's requirement: once a project has chosen a practice, the agent should not see or
focus on other detected practices unless the user asks. Selecting a practice is therefore a **scope**,
distinct from enabling provider code (Decision 21) and from detection.

## User cases

- **A. Migrated team, stale `SPEC.md`s remain, OpenSpec selected.** A soft scope lets the agent follow
  a stale invariant; a strict scope keeps `spec_*` and `brainstorming` out. → strict for the agent.
- **B. ThinkRail specs plus `docs/adr/`.** ADRs are decisions the task needs, not a competing
  workflow. → exclusivity applies only among workflow-owning providers; knowledge providers
  (Markdown, ADR, OKF) stay additive context.
- **C. Transition: new work in OpenSpec, the old ThinkRail graph still true.** The team wants the graph
  as reference, not as process. → a provider can be *reference* without *governing*.
- **D. Monorepo: Kiro frontend, OpenSpec backend.** One per-project selection is wrong; IDEs link
  several external projects per root. → later: selection as a list of `{provider, pathScope}`; now:
  one entry, with the shape allowing the list.
- **E. "What does the old server SPEC say about X?"** The agent reads the file. Strictness withholds
  skills, tools and prompt mentions — never file access. No mechanism needed.
- **F. "Use the brainstorming interview for this one task."** Explicit `/skill:brainstorming` — pi's
  forced load, exists today. Per task, not persisted. That *is* the widening mechanism.
- **G. GSD governs, runtime absent.** `governs` with status `native operation unavailable`; read-only,
  stated in the working agreement.

## Proposed scope model (not decided)

A **per-provider scope state** on the project:

| State | Meaning | Default |
|---|---|---|
| `governs` | the practice the workflow follows; its skills, ops and plan capability are active | the selected provider; ThinkRail when a successful scan found nothing (D2) — exactly one |
| `reference` | catalog and read tools visible; skills and ops not loaded | knowledge providers |
| `hidden` | not in the agent's catalog, tools or prompt; UI keeps a collapsed "N other practices detected" entry | unselected workflow providers |

Changed in the working agreement; per task overridden only by an explicit `/skill:` invocation
(case F). Isolation also simplifies trust: whatever gate native operations get applies to the
governing provider only; unselected providers never run anything.

## Alternatives considered

- **Binary governs / hidden** — simpler; case C (transition) and case B (ADR as context) lose their
  standing.
- **Binary governs / reference** — nothing hidden; case A (stale specs) regresses.
- **No provider kinds, one `canGovern` flag** — the same behavior as the workflow/knowledge split,
  expressed as a flag.
- **Workflow providers only** — Markdown and ADRs are just files; no catalog for team documents.
