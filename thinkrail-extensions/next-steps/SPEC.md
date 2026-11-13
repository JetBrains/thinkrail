---
id: module-ext-next-steps
type: module-design
status: draft
title: Next-step suggestions extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api, module-locales, module-pi-next-steps]
references: [submodule-web-chat, submodule-server-assist]
---

## Responsibility

When a turn finishes, the agent offers the user one-click next messages: follow-up prompts ("Run the
e2e suite", "Open a PR") or short answers to a question its final message ended on ("Yes, go ahead").
They show as chips above the composer. A click (or Alt+N) sends one as the user's next message
([[submodule-web-chat]] owns the chip row). On by default, switchable in Settings → Extensions.

## Boundary

- `./server` default-exports `defineServerExtension({ name: "next-steps", title, description, extensions })`,
  composing the portable package ([[module-pi-next-steps]]) unchanged as one **parent-only** factory:
  `extensions: [createNextStepsExtension()]`. It uses no session services, children, skills or settings.
  The package's terminal row never appears here, because ThinkRail binds pi as `"rpc"`. Imports:
  `extension-api/server` and `@thinkrail/pi-next-steps`.
- `./web` default-exports a descriptor that registers the tool as a **routine** row (summary "Suggested N
  next steps", the list as its body), plus the `composerSuggestions` reader ([[module-extension-api]]).
  The reader prefers the result's normalized `details.suggestions` and falls back to the call's
  arguments. It type-imports the details shape from the package's `./core`; the boundary rules allow
  only type imports of an extension's own pi package. Strings are `nextSteps.*` keys.

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
- **Best-effort by decision; no nudging.** Measured with real models: vanilla pi with Claude Sonnet 5.5
  called the tool in 2 of 2 finished turns. ThinkRail, whose system prompt is much busier, with Claude
  Opus 4.8 at low effort called it in 1 of 3. Two remedies were rejected in favor of best-effort:
  - stronger guidance plus a per-turn system-prompt reminder (the `set_title` pattern);
  - an `agent_before_settle` nudge that asks the model once more when a finished run is about to end
    without the call (one extra request per forgotten turn).

  Revisit if users miss chips.
- **The tool is a published pi package.** The first cut kept the tool in `./server`, reasoning that a
  terminal has no chips. pi's TUI turned out to offer the same affordance through a widget above the
  editor plus Alt+N shortcuts, so the capability moved to [[module-pi-next-steps]] before its first
  merge. The tool guidance is the package's host-neutral wording.

## Verification

Package tests cover the descriptor shape and that it composes the published factory, plus the web
reader. The tool's own behavior is tested in [[module-pi-next-steps]].
Chat tests cover the derivation and chips. `e2e/next-steps.spec.ts` covers seeded transcripts: chips,
reload, click keeps the draft, Alt+N focus scope, and the off switch. `e2e/next-steps.live.spec.ts`
(`@agent`) asks a real agent, explicitly, to suggest next steps after an edit, then checks that the
chips appear and a click sends one. Unprompted reliability is deliberately not asserted (see above).
