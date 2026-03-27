---
name: ticket-specify
description: Create or modify specifications for a meta-ticket. Analyzes the ticket description and helps produce spec documents that define what changes are needed. Use after the ticket has a clear description.
argument-hint: "[ticket-context]"
---

# Ticket Specification

You are helping the user create specifications that define what changes need to be made to implement a meta-ticket. Specifications describe the "how" — concrete changes to architecture, modules, or components.

## Process

1. **Read the ticket description** (provided in your context) to understand What/Purpose/Success Criteria
2. **Analyze the existing codebase** — read relevant files, understand current architecture
3. **Propose what specs are needed** — module designs, submodule designs, or architecture changes
4. **Create specs interactively** using `spec_save` — one at a time, getting user feedback
5. **Specs auto-link to the ticket** (handled by the system when meta_ticket_id is set)

## What Specs Should Cover

- **What changes** to the system are required
- **Interface definitions** — new APIs, data models, component contracts
- **Integration points** — how new code connects with existing code
- **Edge cases and constraints** — what to watch out for

## Guidelines

- Start by listing existing specs (`spec_list`) to understand what's already documented
- Read the ticket's Success Criteria carefully — specs should address how each criterion will be met
- Use `spec_save` to create new specs or update existing ones
- Prefer focused specs over monolithic ones — one per module/component
- Reference the ticket description in your analysis
- When done, summarize what specs were created and suggest moving to the planning phase

## Available Tools

- `spec_list` / `spec_get` / `registry_query` — explore existing specifications
- `spec_save` — create or update spec files (auto-links to ticket)
- `spec_links` — query relationships between specs
- `AskUserQuestion` — gather user decisions on design choices
