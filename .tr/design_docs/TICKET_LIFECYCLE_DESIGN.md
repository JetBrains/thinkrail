---
id: ticket-lifecycle
type: architecture-design
status: active
title: Ticket Lifecycle
parent: design-doc
covers:
  - backend/app/board/state_machine.py
  - backend/app/board/models.py
  - backend/app/board/service.py
  - backend/app/board/plan.py
  - backend/app/board/patch.py
  - backend/app/board/artifact_paths.py
  - backend/app/board/storage.py
  - backend/app/agent/artifacts.py
  - backend/app/agent/tools/propose_change.py
  - backend/app/agent/tools/preview.py
  - backend/app/agent/tools/label_artifact.py
  - backend/app/agent/tools/change_ticket_status.py
  - backend/app/agent/tools/suggest_description.py
  - claude-plugin/skills/ticket-product-design/SKILL.md
  - claude-plugin/skills/ticket-technical-design/SKILL.md
  - claude-plugin/skills/ticket-amend-specs/SKILL.md
  - claude-plugin/skills/ticket-implementation-plan/SKILL.md
  - claude-plugin/skills/ticket-implement/SKILL.md
  - frontend/src/components/TicketDetail/
tags:
  - tickets
  - lifecycle
  - kanban
  - artifacts
---

# Ticket Lifecycle

> Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md) | Status: **Active** | Updated: 2026-05-30

## Table of Contents

1. [Overview](#overview)
2. [Lifecycle (seven states)](#lifecycle-seven-states)
3. [Storage layout](#storage-layout)
4. [Artifacts](#artifacts)
5. [Per-session artifact tracking](#per-session-artifact-tracking)
6. [Drafting skills](#drafting-skills)
7. [Implementation orchestration modes](#implementation-orchestration-modes) — *includes v2 planned subagent design*
8. [MCP tools that drive the flow](#mcp-tools-that-drive-the-flow)
9. [Ticket detail UI](#ticket-detail-ui)
10. [Session routing](#session-routing)
11. [Backend as source of truth](#backend-as-source-of-truth)
12. [Known limitations](#known-limitations)

## Overview

A ticket is a unit of intent — an idea, feature, bug, or improvement — that walks a deliberate seven-state lifecycle from a one-line title to merged work. Each state corresponds to a single drafting or execution skill. Each skill produces (or evolves) a concrete on-disk artifact under the ticket's folder. The ticket's `status` field is the canonical record of which phase has been completed, with two reinterpretations layered on top for the UI: per-phase skipping (`skipped_phases`) and a frontend-derived "current focus" that drives the run/continue affordance.

Sessions are the conversational medium each skill runs in. The ticket detail screen owns a stable three-column layout — phase tree on the left, the session for the focused phase in the middle, an artifact preview / review surface on the right — and auto-creates a draft session for the current phase whenever none exists, so the user never lands on an empty screen.

## Lifecycle (seven states)

| State                  | Skill                          | Artifact produced                       |
|------------------------|--------------------------------|-----------------------------------------|
| `idea`                 | —                              | — (raw ticket: title + optional body)   |
| `product-design`       | `ticket-product-design`        | `product-design.md`                     |
| `technical-design`     | `ticket-technical-design`      | `technical-design.md` (+ `## Self-review`) |
| `amend-specs`          | `ticket-amend-specs`           | mutations to `.tr/design_docs/*.md` recorded in `history.patch` |
| `implementation-plan`  | `ticket-implementation-plan`   | `implementation-plan.md`                |
| `implementing`         | `ticket-implement`             | — (orchestrator drives plan steps)      |
| `done`                 | —                              | — (all plan steps verified)             |

`status = X` means "the work attributed to phase X has been performed and `ChangeTicketStatus` was called at the end of X's skill run". Skills call `ChangeTicketStatus` as their final step.

### Transitions

```
idea                 → product-design
product-design       → idea, technical-design
technical-design     → product-design, amend-specs
amend-specs          → technical-design, implementation-plan
implementation-plan  → amend-specs, implementing
implementing         → implementation-plan, done
done                 → implementing
```

Rules enforced by `backend/app/board/state_machine.py`:

- One step forward at a time; one step backward at a time; no skipping ahead or back over multiple states.
- Only `implementing → done` may end the ticket. Skills cannot jump straight to `done`.
- `done → idea` is forbidden. From `done`, the only move is back to `implementing` (re-open).

### Skipped phases

A ticket carries `skipped_phases: list[TicketStatus]`. The vertical phase list in the UI exposes a `✗` icon on every skippable row (every phase except `idea` and `done`, per `is_skippable`). Clicking it adds the phase to the list. The state machine itself stays strict — `VALID_TRANSITIONS` is unchanged. Instead, `BoardService.update_ticket` and `BoardService.skip_phase` post-process target statuses through `next_unskipped_status(current, skipped)`, which walks forward in `_STATE_ORDER` and returns the first phase not in the skipped set (or `done` if everything is skipped). When the user un-skips a phase via `unskip_phase`, the entry is removed; status is not rolled back.

Skip and un-skip both emit `board.ticketUpdated` so all clients converge.

### Stale flags

Backward transitions never delete downstream files — they flag them stale on the ticket and let the next forward run decide what to do. The pair-to-attribute map in `BoardService.on_status_change` (`backend/app/board/service.py:341-345`):

```
("technical-design", "product-design") → technical_design_stale
("amend-specs",      "technical-design") → history_stale
("implementation-plan", "amend-specs") → implementation_plan_stale
```

Writing a fresh artifact through `write_artifact` clears the corresponding flag. On entry to a skill whose artifact is stale, the skill is expected to ask the user "revise from scratch or evolve existing?" before proceeding.

### Commit policy

The only automatic commit driven by the lifecycle fires on `amend-specs → implementation-plan`: `BoardService.on_status_change` runs `git add` + `git commit` on `.tr/design_docs` and the ticket's `history.patch`, with message `[ticket {id}] amend specs`. Failures are logged and swallowed (best-effort). All other artifact writes — `product-design.md`, `technical-design.md`, `implementation-plan.md` — are not auto-committed by the backend; the user commits manually when convenient.

## Storage layout

Each ticket owns a single folder, keyed by stable `mt_<8hex>` ID:

```
.tr/tickets/{ticket_id}/
├── ticket.json              # meta: title, body, status, paths, stale flags, skipped_phases, …
├── product-design.md        # produced by ticket-product-design
├── technical-design.md      # produced by ticket-technical-design (incl. ## Self-review)
├── implementation-plan.md   # produced by ticket-implementation-plan
└── history.patch            # accumulating amendment log (see below)
```

`ARTIFACT_FILENAMES` (`backend/app/board/artifact_paths.py`) is the single source of truth for filename mapping. The `ArtifactKind` literal stays snake_case for Python ergonomics; the on-disk filenames are kebab-case.

The folder is created at `create_ticket` time alongside `ticket.json` so partial state is impossible. `list_tickets` walks `.tr/tickets/*/ticket.json` and silently skips subdirectories without a `ticket.json`, which lets folders survive crash-mid-write without polluting the board.

Legacy data is removed, never migrated. On every `list_tickets` call, `wipe_legacy_meta_tickets` checks for and recursively removes `.tr/meta-tickets/`. A pre-existing `spec-diff.patch` (the old filename for the amendment log) is renamed to `history.patch` on reconciliation. There is no compatibility shim.

`trash_ticket(ticket_id)` archives the entire `.tr/tickets/{id}/` folder as a single trash item; no per-artifact cascade.

## Artifacts

There are four canonical `ArtifactKind` values, each tied to a phase:

| Kind                  | Filename                | Stale flag                    | Phase                |
|-----------------------|-------------------------|-------------------------------|----------------------|
| `product_design`      | `product-design.md`     | (none — first design step)    | `product-design`     |
| `technical_design`    | `technical-design.md`   | `technical_design_stale`      | `technical-design`   |
| `history`             | `history.patch`         | `history_stale`               | `amend-specs`        |
| `implementation_plan` | `implementation-plan.md`| `implementation_plan_stale`   | `implementation-plan`|

### `product-design.md`

PM-style intent capture: Goal, User stories, User requirements, Product value, Success criteria, Validation criteria. Written section-by-section using `ProposeChange` against a skeleton with `<!-- pending -->` markers. YAML frontmatter records `ticket_id`, `kind`, `created`, `updated`.

### `technical-design.md`

Architecture overview, Components, Interfaces, Data flow, Error handling, Testing strategy, Validation criteria, plus a closing `## Self-review` section. Same skeleton + marker pattern. The skill additionally proposes 3-5 architectural approaches inline in chat before writing into the file — the approach discussion happens in `AskUserQuestion`, the chosen approach becomes file content via `ProposeChange`. The self-review pass spans `product-design.md` + `technical-design.md`; blocking issues must be resolved before transition.

### `history.patch` (amendment log)

A phase-tagged, append-only audit of every `ProposeChange` that has hit disk for this ticket — across every phase, not just `amend-specs`. Format (`backend/app/board/patch.py`):

```
# == amendment 1 =================================
# skill:      ticket-amend-specs
# spec_id:    spec_abc12
# section:    Components
# rationale:  Add baz handling per technical-design.md
# applied_as: original
# validation: ok
# timestamp:  2026-05-22T15:30:00Z

--- a/.tr/design_docs/MODULE_X.md
+++ b/.tr/design_docs/MODULE_X.md
@@ -10,3 +10,3 @@
 ## Components
-Foo handles bar.
+Foo handles bar and baz.

# == amendment 2 =================================
...
```

Entries are visual blocks separated by `# == amendment N =====`; each carries a metadata header (skill, spec_id, section, rationale, applied_as, validation, timestamp) plus a standard unified-diff hunk. `parse_patch_log` splits the file and returns structured entries to the UI. The log is read-only — backward transitions through `amend-specs` do not revert it. Legacy entries without `# skill:` parse as `skill: null` and surface only in unfiltered History views.

The `amend-specs` phase has no separate canonical artifact: its work lives entirely in the history log and the touched spec files. The right-column artifact bar surfaces it as a `history` entry, not as a `spec_diff` artifact.

### `implementation-plan.md`

Plan-as-document: Meta + Milestones + Steps (skill, input specs, dependencies, agent instructions, success criteria) + Verification section. Parsed into a `Plan` model (`backend/app/board/plan.py`); the same file backs both the document view in the right column and the live progress dashboard.

### Description (ticket body)

Description is a ticket-level field on `ticket.json` (`body`), not an artifact. Authored by `SuggestDescription` (called at the end of `ticket-product-design`); a short blurb (~5-12 lines) covering What / Purpose / Success Criteria.

Two defenses against an empty body:

1. The drafting skill calls `SuggestDescription` as its closing step.
2. `BoardService.write_artifact(ticket_id, "product_design", content)` runs an auto-fallback when the body is empty: it extracts the first non-empty paragraph after the frontmatter (skipping a leading `# Title`) and assigns it. Idempotent; non-empty bodies are preserved. Fires only for `product_design` writes.

Description is rendered in the left sidebar (`TicketInfo.tsx`) as a click-to-edit Monaco-backed markdown section. There is no separate description banner above the right panel — the banner introduced by an earlier iteration was removed because it duplicated the sidebar.

## Per-session artifact tracking

Ticket-linked sessions accumulate a list of files they touched, persisted to disk so it survives reload. The list backs the right-panel artifact bar's "session files" entries and lets `Refine` resume into a session knowing what it has worked on.

### Backend model

`AgentTask` (`backend/app/agent/models.py`) gains:

```python
class SessionArtifact(BaseModel):
    path: str                                  # project-relative
    kind: Literal["write", "edit", "propose-change", "preview"]
    role: str | None = None                    # agent-set, e.g. "product_design"
    label: str | None = None                   # agent-set human-readable
    first_touched_at: str
    last_touched_at: str

class AgentTask(BaseModel):
    ...
    artifacts: list[SessionArtifact] = Field(default_factory=list)
    preview_path: str | None = None
```

`task.artifacts` and `task.preview_path` are serialized via `update_session_metadata`. All tracking is a no-op when `task.ticket_id is None`.

### Helpers

`backend/app/agent/artifacts.py` exposes three pure helpers, all gated on `task.ticket_id` being set and the path being inside the project root:

- `record_artifact(task, path, kind, project_root)` — append-or-update by normalized project-relative path. Latest-touch wins for `kind`.
- `label_artifact(task, path, role, label, project_root)` — set role/label on an existing entry; no-op for unknown paths.
- `set_preview(task, path, project_root)` — update `task.preview_path`. If `path` is non-None and not yet tracked, also adds it with `kind="preview"`. `path=None` clears the pointer without touching the list.

### Call sites

| Site | Records |
|---|---|
| Runtime interceptor for `Write` / `Edit` / `NotebookEdit` | `record_artifact(kind="write" or "edit")` |
| `ProposeChange` tool handler (`backend/app/agent/tools/propose_change.py`) | `record_artifact(kind="propose-change")` after a successful apply |
| `SetPreviewFile` tool handler (`backend/app/agent/tools/preview.py`) | `set_preview(path)` (also records as `kind="preview"` if unknown) |
| `LabelArtifact` tool handler (`backend/app/agent/tools/label_artifact.py`) | `label_artifact(path, role, label)` |

### Wire protocol

UI-only notifications (not persisted to the event log — ground truth lives in `task.artifacts` and `task.preview_path`):

| Method                | Payload |
|-----------------------|---------|
| `ui/artifactAdded`    | `{ thinkrailSid, artifact: SessionArtifact }` |
| `ui/artifactLabeled`  | `{ thinkrailSid, path, role?, label? }` |
| `ui/setPreviewFile`   | `{ thinkrailSid, path: string \| null, section? }` |

The frontend's `wireEvents` routes each to a `sessionStore` action that appends/merges into `session.artifacts`, updates `session.previewPath`, or sets a transient one-shot `session.previewSection`.

## Drafting skills

Five ticket skills, one per forward-transitioning phase. Each owns a single `ChangeTicketStatus` call at the end of its run.

| Skill | Reads | Writes | Final transition |
|---|---|---|---|
| `ticket-product-design`      | project context, ticket body                                  | `product-design.md` (sections), `ticket.body` via `SuggestDescription` | `idea → product-design` |
| `ticket-technical-design`    | `product-design.md`, existing design docs                     | `technical-design.md` (sections + `## Self-review`)                    | `product-design → technical-design` |
| `ticket-amend-specs`         | `product-design.md`, `technical-design.md`, specs via `spec_search` | mutations to `.tr/design_docs/*.md` (each appended to `history.patch`) | `technical-design → amend-specs → implementation-plan` |
| `ticket-implementation-plan` | applied specs, design docs                                    | `implementation-plan.md`                                              | `amend-specs → implementation-plan` |
| `ticket-implement`           | `implementation-plan.md`                                       | — (orchestration via `suggest_step` or via SDK subagents — see [Implementation orchestration modes](#implementation-orchestration-modes)) | `implementation-plan → implementing → done` |

### Common skeleton + `ProposeChange` flow

The three drafting skills that author markdown files (`ticket-product-design`, `ticket-technical-design`, `ticket-implementation-plan`) follow a shared pattern:

1. `Read` the relevant prior artifacts + project context.
2. `AskUserQuestion` for clarifying inputs (purpose, user stories, architectural approach, plan depth, …). Branching choices like "evolve / from scratch" also go here.
3. `Write` a skeleton with explicit `## <Section>\n\n<!-- pending -->` markers in every section. The marker exists in exactly one place per section, so subsequent `ProposeChange` calls have a unique `old_string` to anchor on.
4. `SetPreviewFile` to surface the file in the right Context Panel's Preview tab.
5. For each section in order: `ProposeChange(file_path, old_string="## Section\n\n<!-- pending -->", new_string="## Section\n\n<content>", section, rationale)`.
   - On `applied: original|edited` → move on (the marker is consumed).
   - On `discuss: true` → revise per feedback, re-propose.
   - On `discuss: false` (reject) → leave the marker in place and move on, or escalate via `AskUserQuestion`.
6. `ClearPreviewFile` (or `SetPreviewFile({ path: null })`).
7. The closing skill-specific step:
   - `ticket-product-design`: `SuggestDescription` with the kanban-card blurb.
   - `ticket-technical-design`: fill the `## Self-review` section via `ProposeChange`; surface blocking issues in chat before allowing transition.
8. `AskUserQuestion` → `ChangeTicketStatus(next)`.

The skills' red-flag blocks prohibit calling `Write` / `Edit` directly on artifact files mid-flow (bypasses the approval gate), bundling multiple sections into one `ProposeChange`, asking for section-content approval via `AskUserQuestion` (the 4-button card is the approval surface), and committing during the skill (the backend commits at `amend-specs → implementation-plan`).

### `ticket-amend-specs`

Operates on `.tr/design_docs/*.md`, not on a per-ticket artifact:

1. `Read` `product-design.md` + `technical-design.md`. Use `spec_search` to enumerate relevant specs.
2. If `history_stale: true`, ask "revise from scratch or evolve existing?".
3. Propose an amendment plan ordered general → specific (goals → architecture → modules → submodules → task specs), rendered as a `thinkrail_visualize` summary box. Iterate via `AskUserQuestion` until approved.
4. For each spec file in plan order:
   a. `SetPreviewFile(path)`.
   b. `Read`; identify sections needing change.
   c. For each section: `ProposeChange(file_path, old_string, new_string, section, rationale)`. On accept, the backend (i) writes `new_string` to disk, (ii) re-reads and runs cheap validations (frontmatter parse + markdown link integrity — warnings never block), (iii) appends a metadata header + unified-diff hunk to `history.patch`, and (iv) auto-links the spec's frontmatter `id` (if present) into `ticket.linked_spec_ids`.
   d. Intra-file self-review pass; propose follow-up `ProposeChange` calls or note "self-review: clean".
5. Cross-file self-review across all touched files.
6. `ClearPreviewFile`.
7. `AskUserQuestion` → `ChangeTicketStatus("implementation-plan")`, which triggers the single commit covering `.tr/design_docs` + the ticket's `history.patch`.

### `ticket-implement`

Pure orchestration. Reads `implementation-plan.md`; proposes / dispatches the next unblocked step(s); waits for completion; re-reads the plan; verifies criteria; repeats. At task #4 it calls `ChangeTicketStatus("done")`. The skill issues `TodoWrite` snapshots tagged `1. Read and summarize plan` / `2. Execute plan steps` / `3. Run verification criteria` / `4. Mark ticket done` so the frontend can render a "Tasks (n/m)" indicator while it runs.

How the orchestrator dispatches each step depends on the *execution mode* chosen at launch — child ThinkRail sessions, or SDK subagents in the orchestrator's own session. The full mode matrix and its data flow are described under [Implementation orchestration modes](#implementation-orchestration-modes).

## Implementation orchestration modes

> **Status:** the `subagent` configurations below are **planned (v2)**. Today's behavior is `subagent_mode = "step-session"` with `step_gate = "approve"` — the section labeled *Step-session mode* describes what currently ships. Two `subagent` configurations are not yet implemented; the rest of this section is the design they will implement, including its UX-testing checklist.

The `ticket-implement` orchestrator can drive plan execution in three configurations, picked at orchestrator launch:

| `subagent_mode` | `step_gate`    | Parallelism                          | Status   |
|-----------------|----------------|--------------------------------------|----------|
| `step-session`  | `approve`      | sequential                           | today    |
| `subagent`      | `approve`      | parallel via stacked approval cards  | planned  |
| `subagent`      | `autonomous`   | parallel, fan-out, no per-step gate  | planned  |

Both fields live on `AgentTask` (and the wire `Session`) with the *current* behavior as defaults. The picker surfaces in `DraftConfigCard` as an "Execution mode" dropdown when the skill is `ticket-implement`. The choice persists in the session metadata so it survives backend restart.

### Step-session mode (today)

Orchestrator calls `suggest_step` → frontend renders a `StepProposalCard` → user approves → frontend issues the existing `agent/runAgent` (the same RPC that starts any session, with `agentInstructions` carrying the step text) → a NEW ThinkRail session is created and attached to the ticket (`ticket_id`); its `sessionId` is written to `plan.steps[step_number - 1].session_id`. The orchestrator receives a completion message when the step session finishes. Sequential by construction; each step is an independent, restart-survivable session.

### Subagent gated mode (planned)

The orchestrator runs in the same session — there are no step sessions. Instead, the orchestrator invokes the SDK's `Task` tool with `subagent_type = "ticket-step-executor"` and a per-step prompt. Approval still happens per step via `suggest_step`:

1. Orchestrator scans `plan.unblocked_steps()` — every step whose `depends_on` chain is satisfied and whose status is `pending`.
2. Orchestrator emits one `suggest_step` tool call per unblocked step in a single assistant turn (the SDK supports parallel tool calls). Each call awaits its own pending request.
3. Frontend renders one `StepProposalCard` per pending `suggest_step` — three unblocked steps means three cards stacked in the orchestrator's chat. Each Approve / Reject resolves independently.
4. As each card resolves, the matching `suggest_step` returns. Approved → orchestrator immediately issues `Task(subagent_type="ticket-step-executor", prompt=...)` for that step. Rejected → no `Task`; orchestrator narrates the rejection.
5. Orchestrator awaits all in-flight `Task` calls before re-scanning the plan for the next batch.

`session.pending_requests` (plural — see WS protocol changes below) tracks concurrent open requests. The StatusBar "needs attention" counter sums them.

### Subagent autonomous mode (planned)

Identical to gated, minus the `suggest_step` round-trip. The orchestrator goes straight to `Task` calls for every unblocked step. The user sees `Task` tool blocks streaming in the orchestrator chat; no approval cards.

### Subagent definition

One generic agent registered when the orchestrator runtime boots in `subagent_mode = "subagent"`:

```python
# backend/app/agent/subagents.py (new)
TICKET_STEP_EXECUTOR = AgentDefinition(
    name="ticket-step-executor",
    description="Execute one plan step for a ticket.",
    # Same tools surface a step session has today — file editing
    # (Read/Write/Edit/Grep/Glob/Bash), ProposeChange,
    # SetPreviewFile/ClearPreviewFile, LabelArtifact. Explicitly
    # excluded: suggest_step (only the orchestrator emits these)
    # and ChangeTicketStatus (only the orchestrator advances the
    # ticket lifecycle).
    tools=[...],
    system_prompt="""You are executing one plan step. Read the
    referenced specs and source, do the work, propose edits via
    ProposeChange, and return a one-paragraph summary of what
    you changed.""",
)
```

Registered via `options.agents` when the runtime starts an orchestrator session in subagent mode. Subagents inherit the orchestrator's permission mode (matches SDK behavior); cost / usage is attributed to the parent session.

### Step prompt convention

The orchestrator's `Task` call prompt starts with a self-identifying marker:

```
[thinkrail-step ticket=mt_abc12 step=5]
<step.description>

Context:
<step.context if any>
```

The tool interceptor in `_persisting_notify` recognises this marker on a `toolCallStart` for `Task`. It parses `ticket` and `step`, then:

1. Writes the current event index to `plan.steps[step - 1].event_index`.
2. Flips `plan.steps[step - 1].status` to `running`.
3. Persists the plan.

On the matching `toolCallEnd`, the interceptor inspects the `Task` result and sets `status` to `done` or `error` accordingly.

### Plan dependencies (required for parallelism)

`PlanStep` gains `depends_on: list[int] = Field(default_factory=list)`. The `ticket-implementation-plan` skill is updated to populate this field when authoring plans (one line in its SKILL.md asking the planner to identify which prior step numbers each step actually needs). `Plan.unblocked_steps()` returns steps where every entry in `depends_on` has `status == "done"`.

Existing plans (pre-feature) deserialize with `depends_on = []` — interpretation: each step depends on the prior step in number order, preserving today's sequential semantics. A linear-fallback path in `unblocked_steps()` handles this without a data migration.

### Failure policy

Global setting `tickets.subagentFailurePolicy` in `.tr/settings.json`, default `"fail-fast"`:

| Value                | Behavior |
|----------------------|----------|
| `fail-fast` (default)| First sibling failure → orchestrator stops issuing new `Task` calls. In-flight siblings finish their current step (no mid-execution cancellation in v2). User sees a "step N failed; halted further dispatch" summary. |
| `wait-all`           | Orchestrator gathers all sibling results, then reports the aggregate. Useful when steps are truly independent and partial failure shouldn't block others. |

In both cases, individual step statuses on the plan record `done` or `error` per the `Task` result; nothing is silently dropped.

### Step row interaction (UI)

`TicketPhaseList` renders one row per step under the implementing phase. The `▶` action picks behavior from the step's recorded fields, in this priority:

1. `step.session_id` set → open that session in the center column *(step-session mode)*.
2. `step.event_index` set → dispatch through `ticketRouteStore.pendingScroll` to scroll the orchestrator's chat to that event *(subagent mode)*.
3. Neither set → row is informational only (status badge such as `pending`); no click affordance.

The two fields are mutually exclusive in practice: a step is run via one mechanism or the other, never both. The renderer reads whichever field is set; mode-awareness lives entirely in the data, not in the component.

### Why not first-class persisted subagents

A persisted `SubagentExecution` model with its own JSON file and lifecycle was considered. Rejected because:

1. The chosen step-row UX is "inline jump in orchestrator chat" — that's a pointer into the parent's `events.jsonl`, not a session-shaped artifact. A separate persistence layer would carry no UI affordance.
2. If a step needs independent persistence (restart-survival, replay, fork), the right answer is to run it in step-session mode. That's why step-session stays the default and keeps shipping.
3. Adding the model later is non-breaking: the subagent-mode plumbing emits `Task` events; a future `SubagentExecution` layer can be derived from them.

### WS protocol change

`Session.pending_request: PendingRequest | None` → `Session.pending_requests: list[PendingRequest]`. Each entry carries its own `request_id`. The existing `agent/respond` RPC already takes a `request_id` parameter, so its semantics are unchanged. The frontend renders one card per entry; the StatusBar `needs attention` count is `len(pending_requests)`.

Coordinated change between backend and frontend with no compat fallback — the renamed field replaces the old one in one PR.

### Testing the orchestration modes

**Unit + mock-driven tests.**

- `backend/tests/agent/test_subagents.py` (new): subagent registration via `options.agents`, prompt-convention parsing, the `_persisting_notify` interceptor's `event_index` + status updates, fail-fast vs wait-all orchestrator narration.
- `backend/tests/board/test_plan.py` (extended): `depends_on` round-trip; `unblocked_steps()` over linear-fallback plans and explicit-dependency plans.
- `backend/tests/agent/test_service.py` (extended): `pending_requests` list lifecycle (open, resolve by id, partial resolution).
- `backend/tests/rpc/test_methods_agents.py` (extended): WS protocol with concurrent pending requests.
- Mock-driven runtime tests inject synthetic `toolCallStart` / `toolCallEnd` events into a fake orchestrator session to verify the interceptor pipeline updates plan steps correctly. Fast, deterministic, in-process.

**Frontend unit tests** — `SessionPanel/__tests__/parallel-cards.test.tsx` (new) for stacked card resolution; `TicketPhaseList.test.tsx` (extended) for the `event_index` vs `session_id` branch; `sessionStore` tests for the `pending_requests: list` shape.

**UX verification on `/Users/danya/projects/aiir/demo-board/`** — a real-browser smoke test driven via `chrome-devtools-mcp`, run against the demo project so the main ThinkRail checkout stays clean. Iterate fixes against this checklist until every item passes without intervention:

1. Launch backend + frontend pointing at `demo-board`; open `http://localhost:3000`.
2. Create a fresh ticket with a 3-step plan where step 2 and step 3 do NOT `depends_on` each other.
3. Start `ticket-implement` from the draft config card. Verify the "Execution mode" dropdown is present; default is "Step sessions, approve each."
4. Pick "Subagents, approve each." Approve the plan. Verify the chat shows one `suggest_step` card for step 1 (steps 2 + 3 depend on step 1's completion).
5. Approve step 1. Verify a `Task` tool block appears in the chat; the step-1 row in the phase tree flips to `running`; on completion flips to `done`.
6. Verify the chat shows two stacked `suggest_step` cards for steps 2 + 3 (independent in the dependency graph).
7. Click the step-2 row in the phase tree → orchestrator chat scrolls to step 2's `Task` block with a brief highlight animation.
8. Reload the page. Verify execution mode persists; `pending_requests` survive (the cards still show); step-row clicks still scroll to the correct event.
9. Reject step 3's card. Verify the orchestrator narrates the rejection without breaking; step 2 continues if approved.
10. Edit `.tr/settings.json` → `tickets.subagentFailurePolicy: "wait-all"`. Restart backend. Force a subagent failure (broken prompt or non-existent file in the step prompt). Verify the orchestrator waits for siblings before reporting.
11. Reset to `fail-fast`. Force a failure mid-batch. Verify the orchestrator stops issuing new `Task` calls; existing in-flight siblings still surface their results.
12. Switch to "Subagents, autonomous" on a fresh ticket. Verify no approval cards appear, `Task` blocks stream automatically, step rows fill in correctly, and dependencies are respected (a `depends_on=[1]` step does not start until step 1 is done).
13. Verify at 1024×768 viewport and in dark mode that stacked cards + chat layout don't overflow.

Any failure on a numbered item is a fix → reload → re-verify from that item. The implementation is not considered complete until all 13 items pass without intervention. The orchestrator's actual LLM behavior (does it correctly fan out a plan?) is intentionally out of scope for this checklist — that belongs in evals, not UX tests; the checklist verifies the *plumbing* responds correctly to mocked or real orchestrator actions.

### Out of scope (deliberate v2 limits)

- Per-subagent independent restart / resume — use step-session mode if the user needs it.
- "Approve all unblocked steps" batch button — three cards in v2, batch UI deferred.
- Mid-execution subagent cancellation — fail-fast lets in-flight siblings finish.
- Per-subagent cost / usage breakdown — parent attribution only.
- Promoting a subagent run into a step session post-hoc (forking).
- Plan-dependency editor in the UI — `depends_on` is set by the planning skill; manual editing happens in the plan document for now.

## MCP tools that drive the flow

| Tool | Where it lives | Purpose |
|---|---|---|
| `ChangeTicketStatus` | `backend/app/agent/tools/change_ticket_status.py` | Skill-driven status transitions. Validates against `VALID_TRANSITIONS`; triggers `BoardService.on_status_change`. |
| `SuggestDescription` | `backend/app/agent/tools/suggest_description.py` | Inline card to write the ticket body. Auto-applies and (optionally) auto-transitions to `product-design`. |
| `SetPreviewFile` / `ClearPreviewFile` | `backend/app/agent/tools/preview.py` | Open / close the right-panel Preview tab on a file. Auto-approved. Adds the path to the session artifact list with `kind="preview"`. |
| `ProposeChange` | `backend/app/agent/tools/propose_change.py` | Per-edit approval card. `{file_path, old_string, new_string, section?, rationale?}`. Suspends the agent on a Future. |
| `LabelArtifact` | `backend/app/agent/tools/label_artifact.py` | Annotate a tracked artifact with `role` + human-readable `label`. No-op for unknown paths. |

### `ProposeChange` resolution protocol

The frontend resolves a pending `ProposeChange` via the generic `agent/respond` RPC. Response shapes:

| User action | Payload |
|---|---|
| Accept     | `{ behavior: "allow", applied: "original" }` |
| Edit       | `{ behavior: "allow", applied: "edited", edited_new_string }` |
| Discuss    | `{ behavior: "deny", discuss: true, feedback }` |
| Reject     | `{ behavior: "deny", discuss: false, reason? }` |

On `allow`, the backend:

1. Substitutes `old_string` → chosen `new_string` in `file_path` (errors if not unique).
2. Re-reads the file; runs frontmatter + link-integrity validations (warnings never block).
3. Calls `record_artifact(kind="propose-change")` on the session task.
4. For ticket-linked sessions: appends a metadata header + unified-diff hunk to the ticket's `history.patch`, tagged with the calling skill (`ctx.task.skill_id`).
5. For ticket-linked sessions: if the file's frontmatter has an `id` matching a spec, dedup-appends it to `ticket.linked_spec_ids`.

Tool result returned to the agent: `{ applied, validation: "ok"|"warnings", warnings?: [...] }`. On `deny`: `{ behavior, discuss, feedback?, reason? }`.

Error responses (card never appears): `old_string` not unique, not present, file missing, or path outside project root.

For non-ticket-linked sessions, apply + validate still run; the `history.patch` append and the auto-link are silently skipped.

## Ticket detail UI

The ticket detail screen (`frontend/src/components/TicketDetail/`) is a stable three-column CSS grid:

```
┌─────────────┬──────────────────────┬────────────────────┐
│ LEFT ~280px │        CENTER        │       RIGHT        │
│             │                      │ ┌────────────────┐ │
│ Header card │  Session for the     │ │ Artifact bar   │ │
│ Description │  selected phase.     │ └────────────────┘ │
│ Progress    │                      │ ┌────────────────┐ │
│   tree      │  Auto-draft when     │ │ Active preview │ │
│             │  no session exists.  │ └────────────────┘ │
└─────────────┴──────────────────────┴────────────────────┘
```

Each column has a single job: the left is navigation/state, the center is the conversation for the focused phase, the right is the preview / review surface for whatever artifact, file, plan, history entry, or pending diff the user wants to look at.

`selectedPhase` lives on `TicketDetail` and is driven by clicks on phase rows. `selectedArtifact` lives inside `TicketPreviewPanel`. The two are independent — looking at the implementation plan in the right column while chatting with the product-design session in the center is legitimate.

### Left column — `TicketLeftColumn` + `TicketInfo`

- **Header card.** Title, type pill, created/updated timestamps. Status is shown as a read-only colored pill (`ticket-header-badge--{status}`) — there is no status dropdown; transitions happen via the phase tree or skill-driven `ChangeTicketStatus`.
- **Description.** Click-to-edit Monaco markdown section. Save calls `boardApi.update(ticketId, { body })`. Empty state copy invites the user to add a description.
- **Progress** — the phase tree (`TicketPhaseList`), described below.

### `TicketPhaseList`

Seven rows, one per phase, in `PHASE_ORDER`. The `implementing` row is folded into the merged Implementation row (see below); the others render as standard `PhaseRow`s.

Per-row state derives from `(phase, ticket.status, ticket.skippedPhases)`:

```
rowState(phase) =
  if phase in skipped_phases   → "skipped"
  if phase == ticket.status    → "current"
  if STATE_ORDER[phase] < STATE_ORDER[ticket.status] → "past"
  otherwise                    → "future"
```

Glyphs: `✓` past, `✗` skipped, `●` current, `○` future.

All action buttons on every row are 22×22 icon-only with `title` tooltips, right-aligned. No text labels except for the terminal `Mark complete` action.

| Icon | Visible when | Tooltip | Action |
|---|---|---|---|
| `▶` (cta-blue) | current row, session exists | "Continue session" | open session in center |
| `▶` (cta-blue) | current row, no session yet | "Run with AI" | start a session for the phase |
| `▶` (cta-blue) | bootstrap (status=idea, future row = product-design) | "Run with AI" | start `ticket-product-design` |
| `↻` (refine)   | past row with a session | "Re-run this stage" | create a NEW session for the phase |
| `⇺` (back)     | skipped row | "Un-skip this phase" | `unskipPhase` |
| `✗`            | current or future, skippable | "Skip" | `skipPhase` |
| `✓` (cta-green)| done row, ticket.status = implementing | "Mark complete" | `updateTicket({ status: "done" })` |

Clicking a row's *label* opens that phase's session in the center column (if one exists). Clicking an icon stops propagation. `↻` Refine starts a new session — distinct from the label click, which resumes the existing one.

The phase row also exposes a chevron-less "Changes (N)" sub-row whenever the per-phase filter of `history.patch` returns at least one entry. Clicking it opens the right-panel `history` view scoped to that phase.

### Merged Implementation row (`ImplementationPhaseRow`)

Backend keeps two phases (`implementation-plan` + `implementing`); the UI folds them into a single row whose state-pill derives from the underlying status:

| `ticket.status` | State pill |
|---|---|
| `implementation-plan` | `planning` |
| `implementing`        | `executing` |
| `done`                | `done` |
| both skipped          | `skipped` |
| otherwise (future)    | `future` |

A single smart `▶` button picks the right action based on the live drafting/implementing session pair:

1. `planning`, no drafting session → start `ticket-implementation-plan` draft.
2. `planning`, drafting in progress → open drafting in center.
3. `planning`, drafting done, no implementing session → start `ticket-implement` draft.
4. `planning`, drafting done, implementing session exists → open implementing.
5. `executing`, implementing session exists → open implementing.
6. `executing`, no implementing session (edge) → start `ticket-implement` draft.
7. `done` / `skipped` → no button.

A single `✗` Skip dispatches `skipPhase("implementation-plan")` and `skipPhase("implementing")` in sequence; `⇺` Back unskips both. Done counter (`{done}/{total}`) renders next to the pill in the `executing` state from `plan.allSteps()`.

The row never expands — all artifact / plan / session content moved into the right panel and the center column.

### Center column — `TicketCenterColumn`

Thin wrapper that selects the session for `(ticket.id, PHASE_SKILLS[selectedPhase])` and renders `TicketSession` with `hideDraftDiscard={session?.kind === "stage-default"}`.

**Stage-default drafts.** On mount, an effect in `TicketDetail` checks: does a session already exist (live or archived) whose `(ticketId, skillId)` matches the current phase? If not — and the phase is skippable and not skipped — `createDraft` spawns one with `kind: "stage-default"`. This guarantees the center column never lands empty on the current phase. The auto-create effect is gated on `summariesLoaded` and fires at most once per ticket mount (tracked via `autoCreateRanRef`) to avoid racing with user-driven `handleStartSession` calls.

Stage-default drafts hide the Discard button — the UI spawned them, discarding makes no sense. If one ends (agent error, manual completion), the effect spawns a new one on the next mount because `hasMatchingSession()` returns false.

For `idea` and `done` phases — which have no skill — the center column renders a ticket overview (title + markdown body) instead of a session.

### Right column — `TicketPreviewPanel` + `TicketArtifactBar`

The right column owns `selectedArtifact: SelectedArtifact | null` locally. The artifact bar at the top is hybrid: an expanded 32px horizontal tab strip by default, collapsible to a single-line header via a `⇲` button (state persisted in `uiStore.ticketArtifactBarCollapsed`).

The artifact list is derived in `useTicketArtifacts.ts`:

1. `ticket.productDesignPath` → `{kind: "canonical", artifact: "product_design"}`
2. `ticket.technicalDesignPath` → `{kind: "canonical", artifact: "technical_design"}`
3. `ticket.implementationPlanPath` → `{kind: "plan"}` (badged `● live` while `status == "implementing"`)
4. `historyCount > 0` → `{kind: "history"}`
5. Session-touched files (deduped vs canonicals; files touched only by `amend-specs` are excluded — they live under the `history` view to avoid permanent noise once that phase passes)

Default selection on mount prefers the canonical artifact for the ticket's current phase; falls back to the first available entry.

| `selectedArtifact.kind` | Body renderer |
|---|---|
| `canonical`         | `TicketArtifactView` — Monaco preview (read-only by default, "edit" mode toggle) |
| `plan`              | `TicketPlanView` — draft mode while `status == implementation-plan`, live progress tree otherwise |
| `history`           | `TicketHistoryView` — collapsible cards per amendment, optional `phaseFilter` |
| `file`              | `TicketFileView` — Monaco wrap for non-canonical files |

### `ProposeChange` chip + Review surface

`ProposeChange` proposals render in the chat as a compact `ProposeChangeChip` (one per `filePath`) summarising hunk counts and progress. The chip exposes Accept all / Reject all / Discuss / Review → bulk actions; bulk actions operate only on still-pending hunks and iterate in agent-issue order.

The "Review →" button sets `uiStore.activeReview = {sid, filePath}`. The right column honours it: when the active session belongs to the current ticket, `TicketPreviewPanel` swaps the body for `ReviewPanel`. Hunks render inline on a snapshot of the document:

- For `.md` / `.markdown` — WYSIWYG via `react-markdown` with redline-styled hunk overlays. Short same-paragraph edits use word-level diffs (`diff-words-with-space`); longer edits use block-level struck-through-old + inserted-new paragraphs.
- For code — monospace unified `+`/`-` lines with the same per-hunk toolbar.

Per-hunk states: Pending (blue) → Accepted (green) / Rejected (red, opacity 0.55, strikethrough) / Editing (orange, inline single Monaco editor seeded with `newString`) / Discussing (purple, textarea below the diff). `Editing` and `Discussing` are transient UI states — they vanish if the user navigates away, and the hunk reverts to Pending. The Accepted/Rejected status itself derives from `session.answeredRequests`; it is not stored separately.

A `Focused` ↔ `Full file` toggle in the panel header collapses unchanged regions to `… N unchanged lines …` (default Focused; best signal-to-noise for spec edits). Markdown gets an extra `Rendered ↔ Source` toggle. The bottom action bar mirrors the chip's bulk controls and disappears when zero hunks remain pending.

Hunk anchoring uses a snapshot of file contents captured when the panel opens, so accepting hunk 1 (which inserts text) doesn't invalidate hunk 2's `old_string`. The panel re-reads from disk only on (a) explicit Refresh or (b) a fresh `ProposeChange` event for the same file. If an external edit during review breaks an anchor, the hunk shows `⚠ Stale — file changed externally` and disables Accept (Edit and Reject still work).

## Session routing

A session attached to a ticket carries `task.ticket_id` (alias `meta_ticket_id` on the legacy wire); the frontend `Session.ticketId` (legacy `metaTicketId` in `SessionSummary` for grouping) is the projection.

- **SessionPanel tabs** — sessions with a ticket are owned by the ticket and never appear as standalone tabs.
- **SessionManager** — `groupByTicket` collapses all ticket-linked sessions into a single card per ticket (`SessionManager/groupByTicket.ts`), ordered by `updatedAt` and status priority (`running` > `waiting` > … > `done`).
- **StatusBar / notifications** — dropdowns route to the ticket view rather than opening a standalone session pane.
- **Step sub-sessions / subagent step blocks** — `ticket-implement` orchestrates each plan step either as a child ThinkRail session (today) or as a `Task` tool call against the SDK's `ticket-step-executor` subagent (planned). The chosen mechanism is recorded per step: `plan.steps[i].session_id` for step sessions, `plan.steps[i].event_index` (a pointer into the orchestrator's events.jsonl) for subagent calls — mutually exclusive. Step rows in the phase tree click through to the corresponding session (open in center) or scroll to the corresponding `Task` block in the orchestrator chat. See [Implementation orchestration modes](#implementation-orchestration-modes) for the full design.
- **Orphan sessions** — any `ticket.sessionIds[i]` whose `skillId` doesn't map to a phase (and isn't a plan-step session) collects in a small "Other sessions" group at the bottom of the phase tree.
- **One canonical session per phase.** `(ticketId, skillId)` lookup; "Continue" resumes the same session, "Refine" creates a new one. Phase-row label click opens the existing session in the center column.

The active session for the ticket route is mirrored into `useSessionStore.activeSessionId` whenever the center column is showing a session, so the right `ContextPanel`'s file-preview / chip-resolution wiring can read the active session normally. The mirror is cleared on unmount only if `activeSessionId` still equals the embedded sid (avoids stomping other tabs).

## Backend as source of truth

A consistent rule across the lifecycle: anything derived from session events that the UI needs to read repeatedly is persisted on the backend, not re-derived from the event log every render.

- **Status + skipped phases** live in `ticket.json` and broadcast via `board.ticketUpdated`.
- **Session artifacts + preview path** live in the session's meta JSON via `task.artifacts` / `task.preview_path`; `update_session_metadata` writes the snapshot on every change.
- **Plan progress** lives in `Plan` (`board/plan.py`), updated by `ticket-implement` orchestration; the UI reads it directly.
- **TodoWrite snapshots** from `ticket-implement` are persisted on the backend so the "Tasks (n/m)" sub-row survives reload.
- **Orchestrator detection** is anchored on `skill_id == "ticket-implement"` rather than inferred from event shape.
- **History entries** are parsed server-side from `history.patch` (`parse_patch_log`) and exposed via `board/getHistory` — the UI does not re-parse the diff file in the browser.

The frontend's stores (`boardStore`, `sessionStore`, `uiStore`) are read-through caches over those backend records — optimistic updates roll back on RPC failure, the event bus reconciles concurrent edits, but the source of truth is always the on-disk artifact or the persisted metadata.

## Known limitations

- **No cross-session aggregation at the ticket level.** Each session tracks its own artifacts; there is no rolled-up "files touched by this ticket" view beyond the per-session derivation in the right panel.
- **No reverse-apply of `history.patch`.** The amendment log is a read-only audit. Backward transitions through `amend-specs` set `history_stale` but leave the spec files as-edited; the user (or the next forward run) decides what to do.
- **No per-step session creation in the UI.** Plan-step sessions are only spawned by the orchestrator via `suggest_step`. The phase tree exposes existing step sessions but does not let the user kick off a step manually.
- **Auto-draft proliferation.** Stage-default drafts are lightweight (no agent process) but state grows. The idempotency check on `(ticket, phase)` keeps it bounded; there is no garbage collection.
- **No multi-client sync of UI-local state.** `selectedPhase`, `selectedArtifact`, artifact-bar collapsed state, and review chip `Editing`/`Discussing` states are local to one frontend instance. `board.ticketUpdated` keeps the model in sync; transient UI does not.
- **Mobile alignment is deferred.** The mobile frontend has its own progress / ticket layout pass and does not share this three-column shell.
- **Subagent orchestration mode is planned, not yet shipped.** The `subagent` configurations in [Implementation orchestration modes](#implementation-orchestration-modes) are the v2 design. Today's `ticket-implement` runs in step-session mode only — there is no execution-mode picker in `DraftConfigCard` yet; it lands together with the v2 plumbing.
