---
id: module-pi-next-steps
type: module-design
status: active
title: pi-next-steps extension
parent: architecture
tags: [pi-extension, chat, next-steps]
references: [submodule-web-chat-tools]
---

## Responsibility

A publishable, standalone pi extension for agent-authored optional continuations. It registers the terminating `offer_next_steps` tool, gives generic hosts a readable fallback, and upgrades the same durable result into a native pi selector. ThinkRail’s web presentation lives in [[submodule-web-chat-tools]] and joins only by tool name.

## Module graph

The package-root `index.ts` is the pi extension entrypoint. It depends on [[submodule-pi-next-steps-core]] only through `src/index.ts`; the core submodule has no reverse dependency on the entrypoint. No other internal module edges exist.

## Tool contract

Zero suggestions means the agent does not call the tool. A call carries one to three `{ label, prompt }` items: a trimmed action label of at most 60 characters and a trimmed complete user message of at most 500 characters. Blank values and case-insensitive duplicate labels or prompts are rejected. The normalized items are the result `details`; `content` is their numbered plain-text fallback.

The tool is an optional final action after a complete answer and returns `terminate: true`, avoiding an empty follow-up model turn. Its active prompt metadata names the tool explicitly, asks for only concrete useful continuations, and distinguishes it from `ask_user_question`: required input uses the question tool; optional ways to continue use `offer_next_steps`.

An explicit user request for follow-up actions, ways to continue after the answer, or what to do next makes the tool required when concrete continuations exist. The assistant first completes any substantive answer, then includes `offer_next_steps` as the final action of that same assistant response instead of stopping after the answer text or duplicating the continuations as a prose list. This is a semantic instruction to the agent, not a client keyword heuristic; ordinary turns remain omit-by-default.

A non-displayed, ephemeral context reminder repeats that semantic check after any other tool result. This keeps the requirement salient across multi-step agent turns without inspecting the user’s prose or synthesizing options itself. It explicitly preserves omit-by-default behavior when the user did not request continuations, and it does not run after `offer_next_steps` itself.

## Native interaction

Tool execution never waits for a person. In TUI mode, `agent_settled` first confirms that a successful `offer_next_steps` result is the latest message on the active branch, then opens pi’s native selector. Choosing sends the normalized prompt as a real user message; if another extension started work first, it is delivered as a follow-up. Escape cancels without consuming the offer, and `/next-steps` reopens the selector while that result remains current, including after a resumed session. Non-TUI modes keep the durable fallback and perform no interaction at all — `/next-steps` says so rather than opening a second, competing surface beside a host's own presentation.

Currency is always re-read from the session branch, never cached, so a resumed session needs no reconstruction step and a session replacement cannot leave a stale offer behind. The settle handler is deliberately **not awaited**: pi awaits `agent_settled` handlers before reporting idle, and a human-length selector inside one would stall the host.

This ordering is a restart invariant: no human-length wait occurs before the tool result is paired and persisted. A selector inside `execute` is forbidden.

## Public surface

The package root is a pi extension factory declared by its `pi.extensions` manifest. `src/index.ts` is the core submodule's only surface to that entrypoint; the package export map exposes only the root factory. Its package metadata is publication-ready and uses the `pi-package` keyword; no ThinkRail host is required. The stable cross-host contract is the tool name and validated result shape.

## Testing

`src/normalize.test.ts` pins the tool contract (trimming, the 1-3 bound, the length caps, case-insensitive
duplicate labels/prompts, the numbered fallback, and that every rejection names the tool).
`src/offer.test.ts` pins currency against hand-built branches — looking past non-message entries, and going
stale on a later message, a failed result, or details that no longer validate. `index.test.ts` drives the
registered surface through a fake `ExtensionAPI`: termination, the prompt-metadata rules, the ephemeral
post-tool reminder without prompt parsing, and the selector lifecycle (immediate send, cancellation leaving
the offer intact, a stale offer never opening it, the busy follow-up path, non-TUI silence, and `/next-steps`
after a resume).

## Boundary

- **Owns:** the tool schema, normalization/validation, fallback output, current-offer reconstruction, native selector flow, and `/next-steps` command.
- **Allowed deps:** `@earendil-works/pi-coding-agent` and `typebox`, supplied as pi-package peer dependencies.
- **Forbidden:** ThinkRail packages or apps, host wire types, browser APIs, project-specific state, and a nested model call.
