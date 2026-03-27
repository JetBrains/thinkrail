---
name: ticket-describe
description: Help formulate a structured meta-ticket description with What, Purpose, How, and Success Criteria sections. Use when a ticket needs a clear, well-structured description.
argument-hint: "[ticket-title-or-context]"
---

# Ticket Description

You are helping the user formulate a clear, structured description for a meta-ticket. The description should capture the essence of what needs to be done, why, and how success will be measured.

## Process

1. **Read the ticket title and any existing body** to understand the context
2. **Ask one question at a time** using AskUserQuestion to fill in each section
3. **Build the description incrementally** — show what you have after each answer
4. **Write the final structured description** as the ticket body

## Output Format

The ticket body should follow this markdown template:

```markdown
## What
[Clear statement of what needs to be built, changed, or fixed]

## Purpose
[Why this matters — business value, user need, or technical necessity]

## How (Approach)
[High-level technical approach — not implementation details, but direction]

## Success Criteria
- [ ] [Criterion 1 — as specific and verifiable as possible]
- [ ] [Criterion 2 — ideally something that can be tested or checked]
- [ ] [Criterion 3]
```

## Guidelines

- **Success Criteria are the most important section** — make them as actionable and verifiable as possible. Prefer criteria that can be checked by running a command, inspecting output, or testing behavior.
- Keep "What" to 1-2 sentences. Keep "Purpose" to 1-2 sentences.
- "How" is optional and high-level — don't design the solution here.
- Ask the user for their input on each section, but proactively suggest refined versions.
- When the description is complete, tell the user to save it (the frontend handles updating the ticket body).

## Available Tools

- Use `AskUserQuestion` to gather information interactively
- Use `spec_list` and `registry_query` to understand existing project context
- Use `bonsai_visualize` to show structured summaries if helpful
