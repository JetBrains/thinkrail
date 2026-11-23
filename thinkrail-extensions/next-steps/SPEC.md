---
id: module-ext-next-steps
type: module-design
status: active
title: Next-step suggestions extension
parent: module-thinkrail-extensions
depends-on: [module-extension-api, module-locales, module-pi-next-steps]
references: [submodule-web-chat, submodule-server-assist]
---

## Responsibility

When a turn finishes, the agent offers the user one-click next messages: follow-up prompts ("Run the
e2e suite", "Open a PR") or short answers to a question its final message ended on ("Yes, go ahead").
They show as chips above the composer. A click (or Alt+N) sends one as the user's next message
([[submodule-web-chat]] owns the chip row). On by default, switchable in Settings → Extensions & skills.

## Boundary

- `./server` default-exports `defineServerExtension({ name: "next-steps", title, description, extensions })`,
  composing the portable package ([[module-pi-next-steps]]) as one **parent-only** factory with
  ThinkRail's question rule appended to the package's guidelines:
  `extensions: [createNextStepsExtension({ guidance: { promptGuidelines: [...DEFAULT_PROMPT_GUIDELINES,
  QUESTIONS_GO_TO_ASK] } })]`. It uses no session services, children, skills or settings.
  The package's terminal row never appears here, because ThinkRail binds pi as `"rpc"`. Imports:
  `extension-api/server` and `@thinkrail/pi-next-steps`.
- `./web` default-exports a descriptor that registers the tool as a **routine** row (summary "Suggested N
  next steps", the list as its body), plus the `composerSuggestions` reader ([[module-extension-api]]).
  The reader prefers the result's normalized `details.suggestions` and falls back to the call's
  arguments only when there is no result list; an empty `details.suggestions` still wins, so a refused
  call ([[module-pi-next-steps]], *Decisions*) offers no chips. Its row reads as a request for the
  answer instead of "Suggested 0 next steps". It type-imports the details shape from the package's
  `./core`; the boundary rules allow only type imports of an extension's own pi package. Strings are `nextSteps.*` keys.

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
- **Only when nothing continues.** Because the call ends the run, the guidance keeps the package's
  "after you finish a turn" framing and adds two clauses: never before the work is done (for example
  while plan steps remain), and skip it while waiting on background work the agent started (besides a
  question tool's answer). The agent judges this; the chat does not second-guess it from background work.
  *Post-mortem:* a first rewording gated the call on "only when nothing else will continue … never while
  other work remains" in the description, snippet and guidelines; in a live probe (Claude Opus 4.8 via
  Central, five small unprompted tasks plus a plan, a background command and a decision) it dropped the
  unprompted call to 0 of 9, against 3 of 5 for the original wording on the same tasks. The clause-only
  wording measured 2 of 5, ended the three-step plan with one call after its last step, and made no call
  before the background completion or instead of `ask_user_question`.
  A dev server left running keeps its chips, and a row offered by mistake before a background
  completion disappears when that completion wakes the agent ([[submodule-web-chat]], *Composer
  suggestions*). Hiding chips while any background work runs was rejected: a long-lived command would
  hide them for good.
- **Zero is valid; at most nine.** The agent skips the call when nothing meaningful applies (no filler),
  typically offers about three, and `execute` trims, collapses whitespace, drops empty or
  case-insensitive duplicate items and keeps the first nine — one per key, the terminal's and the chat's. A forgotten call simply means no chips. That's the accepted cost of
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
  merge. The tool guidance is the package's host-neutral wording plus one ThinkRail rule (below).
- **Yes/no gets chips; a decision goes to `ask_user_question`.** The package lets chips answer a simple
  question ending the final message. In ThinkRail that would compete with the structured question card:
  an agent could ask a real decision in prose and offer chips instead. `QUESTIONS_GO_TO_ASK` limits chips
  to a yes/no question about a step the agent proposes ("Shall I open a PR?" → "Yes, open it") and sends
  any decision or choice between options to `ask_user_question` when that tool is available (it can be
  switched off, so the rule names it conditionally).

## Verification

Package tests cover the descriptor shape and that it composes the published factory with ThinkRail's
appended guideline, plus the web reader. The tool's own behavior is tested in [[module-pi-next-steps]].
Chat tests cover the derivation, the numbered chips, the target chat their global keys act in and the
done outcome of a reloaded round. `e2e/next-steps.spec.ts` covers seeded transcripts: chips and their
numbers, reload (chips and the round's done status), click keeps the draft and leaves focus in the input,
Alt+N from the input, the conversation, the Files tree and a workbench tab (another group's too) but not
inside a dialog, the terminal or Monaco, Shift+click and Shift+Alt+N into the input, the off switch, and a refused call (its row reads as a
request for the answer, no chips; the retried call's chips show). `e2e/next-steps.live.spec.ts`
(`@agent`) asks a real agent, explicitly, to suggest next steps after an edit, then checks that the
chips appear and a click sends one. Unprompted reliability is deliberately not asserted (see above).
