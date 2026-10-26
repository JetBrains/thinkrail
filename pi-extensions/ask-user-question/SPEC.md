---
id: module-pi-ask-user-question
type: module-design
status: draft
title: "@thinkrail/pi-ask-user-question — the ask_user_question tool for vanilla pi"
parent: module-pi-extensions
tags: [pi-extension, questionnaire]
---

## Responsibility

The published, portable half of the structured-question capability: one tool, `ask_user_question`, that
pauses the run until a person answers multiple-choice questions and returns a model-facing envelope. It
knows nothing about ThinkRail. It asks in one of three ways: a terminal questionnaire (pi's interactive
mode), one dialog per question (RPC hosts such as VS Code or Zed), or an embedder's injected asker.
ThinkRail composes it through [[module-ext-ask-user-question]], injecting an asker backed by the host's
answer mailbox.

## Public surface

- **Default export**: the factory with the built-in asker, which `pi install` loads through the `pi`
  manifest.
- **`createAskUserQuestionExtension({ ask?, announce?, guidance? })`**:
  - `ask: AskUserQuestionAsker` replaces the built-in asking. The embedder is then the UI, so there is no
    `hasUI` gate.
  - `announce(toolCallId)` is called from the `message_end` hook for the ask call the batch keeps, when
    the assistant's stop reason lets it execute (`executableAskCallIds`). An embedder that tracks calls
    outside `execute()` starts tracking here, so only calls this extension runs are tracked.
  - `guidance` replaces the description, `promptSnippet` and `promptGuidelines`, for a host whose UI
    behaves differently, such as ThinkRail's composer supersede.
- **`./core`**: no runtime imports. Exports the tool name, limits, reserved labels, result types and texts,
  plus `validateQuestionnaire`, `buildQuestionnaireResponse`, `outcomeResult`, `isAckDetails`,
  `isolateAskUserQuestionBatch` and `executableAskCallIds`. These are what an embedder needs to repair or continue a question outside
  `execute()`.
- **The tool contract**, which renderers and embedders key on:
  - the name;
  - the argument shape: `questions[]` of `{ question, header, options[]{ label, description, preview?,
    recommendedReason? }, multiSelect? }`;
  - the result per outcome:

    | Outcome | `content` | `details` | `terminate` |
    | --- | --- | --- | --- |
    | `answered` (including partial and Skip) | `buildQuestionnaireResponse` | that builder's details | no |
    | `deferred` | the canonical ack, or the chat text for "Chat about this" | `{kind: "ack"}` | yes |
    | `abandoned` | the stopped text | cancelled | yes |
    | asker rejects | thrown, so pi records a tool error | — | — |

  The types mirror the contracts' `AskUserQuestion*` wire types structurally. Changing them breaks
  ThinkRail's card and its restart repair.

## Decisions

- **The asker owns the Stop/Submit race.** `execute()` never inspects the signal. The built-in askers keep
  an answer given before Stop and resolve `abandoned` otherwise: the stopped text with `terminate`, so pi
  makes no further model request into the aborted run (a thrown error would leave pi to issue one that
  fails as aborted). An embedder applies its own
  ordering; ThinkRail's mailbox lets an accepted Submit beat a later Stop.
- **Deferred ends the run.** With `terminate: true`, pi skips the model request the tool batch would
  trigger but still drains queued steering. A host that queued the user's own message, such as
  ThinkRail's composer supersede, therefore continues with that message. Verified against pi's agent loop
  and in `src/session.test.ts`.
- **Built-in asking by mode:**
  - `ctx.mode === "tui"`: the terminal questionnaire through `ctx.ui.custom`. If `custom()` resolves
    `undefined`, it falls back to dialogs.
  - Any other mode with UI: the dialog walker.
  - No UI: "not available" without asking; the workflow skills then proceed on stated assumptions.
- **The terminal questionnaire matches ThinkRail's card.**
  - Same answer model: `src/questionnaire.ts` ports the card's `deriveAnswer` on purpose, because the card
    may not import a pi package.
  - Single-select: ↑↓ move and select. Multi-select: Space toggles.
  - Other opens a pi-tui `Editor`; typing on its row starts it. `n` adds a note.
  - The "Recommended" badge and the `Why:` line.
  - The selected option's markdown preview: beside the list from 100 columns, below it otherwise, capped
    at 24 lines.
  - A review page listing unanswered questions, Esc to skip, and a "Chat about this" row.
  - Known limit: no viewport for a questionnaire taller than the terminal.
- **The dialog walker trades richness for reach.**
  - One `select` per question, with "Other…" and "Chat about this".
  - Multi-select is a single `input` of "1,3; own text".
  - Previews go into the title (600 characters). No notes and no review page.
  - Dismissing any dialog declines the whole questionnaire.
- **One ask per batch.** A `message_end` hook keeps the first ask as the only tool call, because pi's
  sequential-abort hole leaves unexecuted siblings without results. The model re-issues them after the
  answer. The tool is `sequential` and `model-only`, so codemode scripts cannot call it.
- **No cap on the number of questions; length limits are advisory.** The limits live in field descriptions
  only: a schema `maxLength` would reject the whole call and echo every argument back. Reserved labels
  ("Other", "Type something.", "Chat about this", "Next →") are rejected because the UIs add them.

## Boundary

- **Allowed deps:** peers `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` and `typebox`;
  test-only `@earendil-works/pi-ai` (faux provider).
- **Forbidden:** anything from ThinkRail (`@thinkrail/*`, `apps/*`, `packages/server`) and Bun APIs in
  shipped code.

## Structure

- `index.ts`: exports and the default export.
- `src/core.ts`: the contract.
- `src/schema.ts`.
- `src/extension.ts`: the factory and default guidance.
- `src/dialogs.ts`.
- `src/questionnaire.ts`: the answer model.
- `src/tui.ts`: the questionnaire and transcript renderers.

## Verification

- Unit tests per module.
- `src/session.test.ts` runs the tool in a real `AgentSession` on pi-ai's faux provider:
  - an answer continues the run;
  - "Chat about this" ends it after one model call;
  - sibling tool calls are dropped.
- The parity gate drives the terminal and dialog paths with a scripted UI against the packed tarball
  under Node.
- Before the first publish: a manual check in a real terminal (Ghostty or iTerm2, and inside tmux).
