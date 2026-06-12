---
name: ticket-implementation-plan
description: Create an implementation plan for a meta-ticket. Reads product-design.md + technical-design.md and the (now-amended) project specs, breaks the work into ordered steps. On entry the previously-approved spec-diff.patch is applied to project specs. Use when a ticket is in the `spec-diff` state.
icon: "🗺️"
group: Ticket
requires: ticket
argument-hint: "[ticket-context]"
---

# Ticket: Implementation plan (spec-diff → implementation-plan)

You are writing the implementation plan. **On entry to this step, the backend automatically applies `spec-diff.patch` to the project's `{{TR_DIR}}/design_docs/*.md` files** (if not already applied), so when you read specs they reflect the ticket's target state.

If the apply failed (conflict), the user will see an error before this skill starts; you should not be invoked in that case.

## Process

0. **Initialize task list** — call `TodoWrite` ONCE with the 6 items below; first item (`Examine context`) goes `in_progress`. Re-emit the full list after each task completes, marking the previous task `completed` and the next `in_progress`. The frontend reads the latest snapshot and renders it as the "Tasks (n/m)" sub-row in the phase tree.

   ```
   1. Examine context
   2. Decide plan depth
   3. Propose milestone structure
   4. Draft milestones and steps
   5. Verify against ticket success criteria
   6. Finalize and transition
   ```

1. **Examine context** *(task #1)* — if `{{TR_DIR}}/tickets/{id}/implementation-plan.md` already exists (possibly with `implementation_plan_stale: true`), read it; ask via `AskUserQuestion`: "Existing plan found. Revise from scratch or evolve existing?" Preserve step numbers and session IDs from previous versions. Then `Read` `product-design.md` + `technical-design.md` + the updated `{{TR_DIR}}/design_docs/*.md` files (use `spec_search`).

2. **Decide plan depth** *(task #2)* — ask via `AskUserQuestion`: "How granular? (a) Milestones only, (b) Milestones + steps, (c) Full detail with small tasks (recommended)."

3. **Propose milestone structure** *(task #3)* — in chat, propose milestones and their step structure. Iterate with the user until aligned. This is conversation, not a file write.

4. **Draft milestones and steps** *(task #4)* — `Write` the plan to `{{TR_DIR}}/tickets/{id}/implementation-plan.md` using the format below. Every step MUST include the 5 mandatory success criteria.

5. **Verify against ticket success criteria** *(task #5)* — walk the ticket's success criteria once more and verify each is addressed by at least one step's success criteria. Patch the plan if anything is missed.

6. **Finalize and transition** *(task #6)* — `AskUserQuestion`: "Plan ready. Move to `implementing`?" If yes, call `ChangeTicketStatus` with `status='implementing'`. (Status === ongoing work: the plan is done; the next active phase is implementing.)

## Plan format

```markdown
# Plan: {ticket title}

## Meta
- **Ticket:** {ticket_id}
- **Status:** draft
- **Updated:** {today}

## Milestone 1: {title}
{Brief description}

### Step 1: {title}
- **Status:** pending
- **Skill:** {skill_id or "default"}
- **Input specs:** [{spec_ids}]
- **Depends on:** (none or Step N)
- **Parallel with:** (none or Step N)
- **Agent instructions:** {Specific guidance for the implementing agent}
- **Success criteria:**
  - [ ] Builds and compiles without errors
  - [ ] No linter/static analysis warnings
  - [ ] All existing tests pass
  - [ ] New changes covered with unit and integration tests
  - [ ] Follows specification constraints
  - [ ] {Custom criterion specific to this step}

## Verification
- [ ] {ticket-level success criterion from description}
- [ ] All success criteria from all steps verified
```

## Guidelines

- Skip the "propose 3-5 approaches" sub-step — plan structure is deterministic from the design doc.
- **Every step MUST include** the 5 mandatory success criteria. Add custom criteria on top.
- After writing, walk the ticket's success criteria once more and verify each is addressed.
- **Be explicit about `Depends on`.** For each step, list the prior step numbers that must complete before this one can start (e.g. `Depends on: Step 2, Step 3`). Steps that only depend on something already done — or have no real dependency on a prior step — should say `Depends on: (none)`. Independent steps with `(none)` become parallel-eligible when the orchestrator runs in subagent mode; over-declaring dependencies forces unnecessary sequencing. Err on the side of identifying genuinely independent work, not on the side of the linear default.

## Available tools

- `Write` — create/update `implementation-plan.md`
- `Read` / `spec_search` — read amended specs + design docs
- `ChangeTicketStatus` — transition to `implementing` (status === ongoing work; plan is done, next active phase is implementing)
- `AskUserQuestion` — collect input on depth + revision
- `TodoWrite` — surface the workflow as live tasks in the ticket's "Tasks (n/m)" sub-row (call once at the start; re-emit after each task to update statuses)

## Red flags — STOP

- About to draft sections without first marking the current task `in_progress` via `TodoWrite`? STOP. The Tasks (n/m) sub-row stalls — users can't see what you're working on.
- About to call `TodoWrite` only once (at the start)? STOP. You must re-emit after each task to update statuses; the frontend reads the latest snapshot per session.
