---
name: ticket-describe
description: Help formulate a structured meta-ticket description with What, Purpose, How, and Success Criteria sections. Use when a ticket needs a clear, well-structured description.
icon: "✏️"
group: Ticket
requires: ticket
argument-hint: "[ticket-title-or-context]"
---

# Ticket Description

You are helping the user formulate a clear, structured description for a meta-ticket. The description should capture the essence of what needs to be done, why, and how success will be measured.

This skill is designed for a wide audience: product managers, architects, developers, team leads, and anyone else involved in defining work. Focus on capturing the 'what' and 'why' — technical implementation details come later in the specification phase.

## Process

1. **Read the ticket title and any existing body** (injected into your context) to understand what the user is thinking
2. **Ask one question at a time** to fill in each section — be conversational, not bureaucratic
3. **Build the description incrementally** — show what you have after each answer
4. **Use `SuggestDescription` to propose the complete description** — the user sees a card and can apply it to their editor or dismiss with feedback
5. If the user says "just write it" or "apply it directly", use `SuggestDescription` with `apply: true` to update the ticket body immediately
6. **Suggest state transition** — After the description is accepted (SuggestDescription returns success), ask the user via `AskUserQuestion`: 'The description looks complete. Shall I move the ticket to Described state?' If the user agrees, call `ChangeTicketStatus` with `status='described'`.

## Output Format

The ticket body should follow this markdown template:

```markdown
## What
[Clear statement of what needs to be built, changed, or fixed]

## Purpose
[Why this matters — business value, user need, or technical necessity]

## Approach (optional)
[Optional high-level direction — keep this non-technical. Skip this section if you're unsure about the approach; it will be refined during specification.]

## Success Criteria
- [ ] [Criterion 1 — as specific and verifiable as possible]
- [ ] [Criterion 2 — ideally something that can be tested or checked]
- [ ] [Criterion 3]
```

## Guidelines

- **Success Criteria are the most important section** — make them as actionable and verifiable as possible. Prefer criteria that can be checked by running a command, inspecting output, or testing behavior.
- Keep "What" to 1-2 sentences. Keep "Purpose" to 1-2 sentences.
- "Approach" is optional and high-level — don't design the solution here.
- Ask the user for their input on each section, but proactively suggest refined versions.
- Adapt your language and questions to the user's apparent expertise level. Avoid technical jargon with non-technical users.
- **Always use `SuggestDescription` to deliver the final description** — never just print it as text. The tool creates an interactive card that the user can apply directly to their editor.

## Available Tools

- Use `SuggestDescription` to propose description text — the user sees a card and can apply or dismiss with feedback
- Use `SuggestDescription` with `apply: true` to directly update the ticket body (use when the user says "just do it" or "write it")
- Use `ChangeTicketStatus` to transition the ticket to a new state (e.g., 'described') after user confirmation via AskUserQuestion
- Use `AskUserQuestion` to gather information interactively
- Use `spec_search` to understand existing project context
- Use `bonsai_visualize` to show structured summaries if helpful
