---
id: module-ext-next-steps
type: module-design
status: draft
title: Next-step suggestions extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api, module-locales]
references: [submodule-web-chat, submodule-server-assist]
---

## Responsibility

When a turn finishes, the agent offers the user one-click next messages: follow-up prompts ("Run the
e2e suite", "Open a PR") or short answers to a question its final message ended on ("Yes, go ahead").
They show as chips above the composer. A click (or Alt+N) sends one as the user's next message
([[submodule-web-chat]] owns the chip row). On by default, switchable in Settings → Extensions.

## Boundary

- `./server` default-exports `defineServerExtension({ name: "next-steps", title, description, extensions })`.
  It has one static **parent-only** factory registering `suggest_next_steps({ suggestions: string[] })`,
  with no session services, children, skills or settings. Imports: `extension-api/server`, pi types and
  `typebox`.
- `./web` default-exports a descriptor that registers the tool as a **routine** row (summary "Suggested N
  next steps", the list as its body), plus the `composerSuggestions` reader ([[module-extension-api]]).
  The reader prefers the result's normalized `details.suggestions` and falls back to the call's
  arguments. Strings are `nextSteps.*` keys.
- The two halves duplicate the tool name rather than share a module, because halves never import each
  other.

## Decisions

- **The main agent writes the suggestions through a tool.** The alternatives were a cheap helper model
  over a transcript excerpt and a second full-context call on the session model after each turn. The
  helper model sees too little: the same lesson that moved chat naming to `set_title`
  ([[submodule-server-assist]]). The second call adds 2–5 s and a full-context cache read per turn. The
  tool costs only its prompt text plus ~50–100 output tokens per turn. Persistence and clearing come
  free from the transcript.
- **Call last, alone, and end the turn.** The guidance asks for the final message first and then a
  solitary call. `execute` returns `terminate: true`, so pi skips another model round trip. pi ends early
  only when every result in a batch terminates, so a call made beside other tools doesn't end the turn,
  and the chat shows no chips for it.
- **Zero is valid; no count cap.** The agent skips the call when nothing meaningful applies (no filler),
  typically offers about three, and `execute` only trims, collapses whitespace and drops empty or
  case-insensitive duplicate items. A forgotten call simply means no chips. That's the accepted cost of
  relying on the model.
- **No portable pi package.** Unlike visualize and ask-user-question, nothing outside ThinkRail could
  use the tool, since the pi TUI has no chips. The tool therefore lives in `./server`.

## Verification

Package tests cover the descriptor shape, guidance, normalization and `terminate`, plus the web reader.
Chat tests cover the derivation and chips. `e2e/next-steps.spec.ts` covers seeded transcripts: chips,
reload, click keeps the draft, Alt+N focus scope, and the off switch. `e2e/next-steps.live.spec.ts`
(`@agent`) checks that a real agent ends a finished turn with the call.
