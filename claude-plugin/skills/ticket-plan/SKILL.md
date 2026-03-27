---
name: ticket-plan
description: Create an implementation plan for a meta-ticket. Reads linked specifications and produces an ordered plan with steps, dependencies, and success criteria. Use after specifications are complete.
argument-hint: "[ticket-context]"
---

# Ticket Planning

You are helping the user create an implementation plan for a meta-ticket. The plan is a markdown document that breaks the work into ordered steps, each with clear success criteria.

## Process

1. **Read the ticket description and linked specs** to understand the full scope
2. **Analyze what needs to be built** — identify distinct implementation units
3. **Propose steps** — ordered, with dependencies between them
4. **Define success criteria** for each step — verifiable, ideally executable
5. **Write the plan** to `.bonsai/plans/{ticket_id}.md`

## Plan Format

Write the plan as a markdown file with this structure:

```markdown
# Plan: {ticket title}

## Meta
- **Ticket:** {ticket_id}
- **Status:** draft
- **Updated:** {today}

## Steps

### Step 1: {title}
- **Status:** pending
- **Skill:** {skill_id or "default"}
- **Input specs:** [{spec_ids}]
- **Success criteria:**
  - [ ] {criterion}

### Step 2: {title}
- **Status:** pending
- **Skill:** default
- **Depends on:** Step 1
- **Input specs:** [{spec_ids}]
- **Success criteria:**
  - [ ] {criterion}

## Verification
- [ ] {ticket-level success criterion from description}
```

## Guidelines

- **Order matters** — put foundational work (models, config) before things that depend on it
- **Each step should be independently executable** — one agent session per step
- **Success criteria should be testable** — "pytest passes", "file exists", "endpoint returns 200"
- **Skill assignment** — use "default" for coding, existing skill IDs for design work
- **Verification section** — copy the ticket's Success Criteria here as the final checklist
- Keep steps focused — a step that takes more than one session is too big
- After writing the plan, tell the user the plan is ready for execution

## Available Tools

- `spec_list` / `spec_get` — read linked specifications
- `registry_query` — understand the project structure
- Read files directly to understand current code
- Write the plan file to `.bonsai/plans/{ticket_id}.md`
