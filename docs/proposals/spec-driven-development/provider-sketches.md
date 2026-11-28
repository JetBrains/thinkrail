# Provider sketches: OpenSpec and ThinkRail-native

Detail for the [architecture doc](../spec-driven-development-architecture.md). Both sketches test the
provider contract — `detect`, `catalog`, `skill`, `ops`, `view`, `plan` — against a real system.

## OpenSpec

Verified against openspec.dev (2026-11: the `spec-driven` schema and schema customization pages).
Behavior varies by version; this is a design input, not a compatibility audit.

| Contract part | Reality | Tier |
|---|---|---|
| `detect` | `openspec/config.yaml` (`schema:`), `openspec/changes/`, `openspec/specs/`, project schema forks under `openspec/schemas/<name>/schema.yaml`. Each change's `.openspec.yaml` pins *its* schema at creation and may set `skip_specs`. Schemas may also resolve from the user's machine or the package, invisible to a file scan. | file parse, trust-free |
| `catalog` | **Changes**: one work item = `proposal.md` + `specs/<capability>/spec.md` deltas + `design.md` + `tasks.md`. **Specifications**: `openspec/specs/<capability-path>/spec.md`, the maintained truth. **Archive**: `changes/archive/<date>-<id>/`. A change's lifecycle is derivable from which artifacts exist per the schema DAG (proposal → specs/design → tasks → apply) — an inference unless `openspec status` reports it. Stores (`planningHome.root`) can place a change outside the worktree. | file parse; CLI for native status |
| `skill` | OpenSpec's own installed skills and commands (they reach ThinkRail through the existing skill aliases), plus per-artifact instructions that live in `schema.yaml` and are resolved with `openspec instructions <artifact> --json`. The workflow literally comes from the project's process. | prose; CLI to resolve |
| `ops` | `validate`, `archive` (merges deltas into main specs), `new change`, `status`, `list` / `show`, `schema fork` / `validate`. All CLI, user-installed. | CLI |
| `view` | Change detail: an artifact DAG with per-artifact status (proposal ✓ · specs ✓ · design – · tasks 2/5). The common model cannot carry a schema DAG → a provider renderer for kind `change`. | web half |
| `plan` | `tasks.md`, `- [ ] 1.1 text`, numbered; a line without a checkbox is not tracked. `mirrored`, truth = native file. The numbering makes the sidecar identity map far more stable than free-text checklists. | sidecar + CAS |

### What it forces into the common model (open question 4)

1. A **work item is a first-class node**, not a file: a change spans four files with its own lifecycle
   and schema.
2. The **locator is abstract**; a path is optional (stores, databases).
3. **Facets are per item**, not per provider: two changes in one repo can follow different schemas.
4. **Lifecycle carries provenance**: `native` (the tool reported it) vs `inferred` (files present).
5. A **small fixed link vocabulary** suffices: `contains`, `depends-on`, `references`, `modifies`
   (delta → main spec), `supersedes` (archive). ThinkRail's `parent` / `depends-on` / `references` /
   `implements` / `covers` map onto the first three.
6. **Trust splits by who controls the code**, not by read vs write: schema and instruction prose is
   repo-controlled (context tier — pi already feeds `AGENTS.md` without trust); the `openspec` binary is
   user-installed (like `git` or `bun`, already run under project trust through bash). Per-entry
   approval is needed only for repo-defined commands — a homegrown practice with scripts, which is the
   repo-MCP case. This is the leading option for open question 5.

## ThinkRail-native

| Part | Mapping |
|---|---|
| `detect` | durable spec nodes present (today's `projectHasSpecs`); task-specs alone are not a practice |
| `catalog` | nodes → artifacts; `type` → purpose; `status` → lifecycle; all `source`; links explicit |
| `skill` | the `brainstorming` family is the provider's workflow; `choosing-a-workflow` its entry; `setting-up-a-project` its *init* op (≈ `openspec init`); `shipping-a-pr` is practice-neutral and reachable from any practice |
| `ops` | `spec_*` tools, `spec_validate` |
| `view` | none: the common Artifacts panel carries it (today's Specs panel becomes that panel) |
| `plan` | the TODO plan *is* its native plan: `mirrored`, truth = host — the per-provider truth rule (D5) pays off here |

The refactor of ThinkRail-native into a provider extension is deferred (D12); fitting it to the
contract on paper is done above so the contract is not shaped around our own format.

## Minimum integration

An integration's minimum is `detect` + `catalog` + a skill. Tools and a provider-owned view are
additions, exactly as a build-system plugin starts with a project resolver and grows a tool window.
Frameworks without an API (GSD Pi keeps state in a database and owns execution) stay read-only unless
embedded, which is the second-runtime non-goal.
