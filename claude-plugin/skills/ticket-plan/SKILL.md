---
name: ticket-plan
description: Create an implementation plan for a meta-ticket. Reads linked specifications and produces an ordered plan with steps, dependencies, and success criteria. Use after specifications are complete.
argument-hint: "[ticket-context]"
---

# Ticket Planning

You are helping the user create an implementation plan for a meta-ticket. The plan is a markdown document that breaks the work into ordered steps, each with clear success criteria.

## Process

1. **Read the ticket description and linked specs** to understand the full scope
2. **Ask the user about plan depth**: "How granular should the plan be? (a) High-level milestones only, (b) Milestones + steps, (c) Full detail with small tasks (recommended)"
3. **Analyze what needs to be built** — identify milestones and distinct implementation units
4. **Propose the plan structure** — milestones, steps within milestones, dependencies
5. **Write the plan** to `.bonsai/plans/{ticket_id}.md`
6. **Suggest state transition** — Ask via `AskUserQuestion`: "The plan is ready. Shall I move the ticket to Planned state?" If yes, call `ChangeTicketStatus` with `status='planned'`

## Plan Format

Write the plan as a markdown file with this structure:

```markdown
# Plan: {ticket title}

## Meta
- **Ticket:** {ticket_id}
- **Status:** draft
- **Updated:** {today}

## Milestone 1: {title}
{Brief description of what this milestone achieves}

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

### Step 2: {title}
...

## Milestone 2: {title}
...

## Verification
- [ ] {ticket-level success criterion from description}
- [ ] All success criteria from all steps verified
```

## Guidelines

- **Order matters** — put foundational work (models, config) before things that depend on it
- **Each step should be independently executable** — one agent session per step
- **Success criteria should be testable** — "pytest passes", "file exists", "endpoint returns 200"
- **Skill assignment** — use "default" for coding, existing skill IDs for design work
- **Verification section** — copy the ticket's Success Criteria here as the final checklist
- Keep steps focused — a step that takes more than one session is too big
- **Milestones** group related steps. Use milestones for large changes; for small changes, a single milestone is fine.
- **Every step MUST include** the 5 mandatory success criteria (builds, no lint warnings, tests pass, changes tested, follows spec). Add custom criteria on top.
- **Agent instructions** should tell the implementing agent exactly what to do: which files to modify, what patterns to follow, what to watch out for.
- **Parallel with** indicates steps that have no mutual dependency and could theoretically run at the same time.
- After writing the plan, go through the ticket's Success Criteria one more time and verify each is addressed by at least one step's criteria.

## Available Tools

- `spec_list` / `spec_get` — read linked specifications
- `registry_query` — understand the project structure
- Read files directly to understand current code
- Write the plan file to `.bonsai/plans/{ticket_id}.md`
- `ChangeTicketStatus` — transition the ticket to 'planned' after user confirmation
