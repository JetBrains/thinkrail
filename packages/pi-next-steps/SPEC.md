---
id: module-pi-next-steps
type: module-design
status: draft
title: pi-next-steps extension
parent: architecture
tags: [pi-extension, chat, next-steps]
references: [submodule-web-chat-tools]
---

## Responsibility

A publishable, standalone pi extension for agent-authored optional continuations. It registers the terminating `offer_next_steps` tool, gives generic hosts a readable fallback, and upgrades the same durable result into a native pi selector. ThinkRail’s web presentation lives in [[submodule-web-chat-tools]] and joins only by tool name.

## Tool contract

Zero suggestions means the agent does not call the tool. A call carries one to three `{ label, prompt }` items: a trimmed action label of at most 60 characters and a trimmed complete user message of at most 500 characters. Blank values and case-insensitive duplicate labels or prompts are rejected. The normalized items are the result `details`; `content` is their numbered plain-text fallback.

The tool is an optional final action after a complete answer and returns `terminate: true`, avoiding an empty follow-up model turn. Its active prompt metadata names the tool explicitly, asks for only concrete useful continuations, and distinguishes it from `ask_user_question`: required input uses the question tool; optional ways to continue use `offer_next_steps`.

## Native interaction

Tool execution never waits for a person. In TUI mode, `agent_settled` first confirms that a successful `offer_next_steps` result is the latest message on the active branch, then opens pi’s native selector. Choosing sends the normalized prompt as a real user message; if another extension started work first, it is delivered as a follow-up. Escape cancels without consuming the offer, and `/next-steps` reopens the selector while that result remains current, including after a resumed session. Non-TUI modes keep the durable fallback and perform no automatic interaction.

This ordering is a restart invariant: no human-length wait occurs before the tool result is paired and persisted. A selector inside `execute` is forbidden.

## Public surface

The package root is a pi extension factory declared by its `pi.extensions` manifest. Its package metadata is publication-ready and uses the `pi-package` keyword; no ThinkRail host is required. The stable cross-host contract is the tool name and validated result shape.

## Boundary

- **Owns:** the tool schema, normalization/validation, fallback output, current-offer reconstruction, native selector flow, and `/next-steps` command.
- **Allowed deps:** `@earendil-works/pi-coding-agent` and `typebox`, supplied as pi-package peer dependencies.
- **Forbidden:** ThinkRail packages or apps, host wire types, browser APIs, project-specific state, and a nested model call.
