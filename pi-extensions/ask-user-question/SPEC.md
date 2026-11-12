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
- **`createAskUserQuestionExtension({ ask?, announce?, guidance?, filePreviews?, checkFile? })`**:
  - `ask: AskUserQuestionAsker` replaces the built-in asking. The embedder is then the UI, so there is no
    `hasUI` gate.
  - `announce(toolCallId)` is called from the `message_end` hook for the ask call the batch keeps, when
    the assistant's stop reason lets it execute (`executableAskCallIds`). An embedder that tracks calls
    outside `execute()` starts tracking here, so only calls this extension runs are tracked.
  - `guidance` replaces the description, `promptSnippet` and `promptGuidelines`, for a host whose UI
    behaves differently, such as ThinkRail's composer supersede.
  - `filePreviews` (default **off**) registers the file-preview fields. Vanilla pi keeps them off because
    nothing there renders files. `checkFile(path, cwd)` is awaited once per distinct path before asking;
    its error fails the call with a text telling the model to write the file first.
- **`./core`**: no runtime imports. Exports the tool name, limits, reserved labels, discuss reasons, result
  types and texts, plus `validateQuestionnaire`, `previewFileSources`, `buildQuestionnaireResponse`,
  `outcomeResult`, `isAckDetails`,
  `isAskUserQuestionArgs`, `isAskUserQuestionResult`, `isolateAskUserQuestionBatch` and
  `executableAskCallIds`. These are what an embedder needs to repair or continue a question outside
  `execute()`.
- **The tool contract**, which renderers and embedders key on:
  - the name;
  - the argument shape: `questions[]` of `{ question, header, preview?, options[]{ label, description,
    preview?, recommendedReason? }, multiSelect? }`, plus `previewFile` / `previewBefore` on a question and
    on each option when `filePreviews` is on (workspace-relative; `previewBefore` makes a before → after
    diff; `preview` and `previewFile` exclude each other);
  - the answer `kind`: `option`, `custom`, `multi`, or `discuss` (with an optional `reason` — `unclear`,
    `irrelevant`, `context` — and the text in `notes`). A picked file preview is echoed as `previewFile`
    (and `previewBefore`), a path, never the file's content;
  - the result per outcome:

    | Outcome | `content` | `details` | `terminate` |
    | --- | --- | --- | --- |
    | `answered` (including partial and Skip) | `buildQuestionnaireResponse` | that builder's details | no |
    | `deferred` | the canonical ack, or the chat text for "Chat about this" | `{kind: "ack"}` | yes |
    | `abandoned` | the stopped text | cancelled | yes |
    | asker rejects | thrown, so pi records a tool error | — | — |

  The argument and result types are the one definition of the questionnaire shape: ThinkRail's card
  type-imports them from `./core`, and the deferral ack `{kind: "ack"}` doubles as the host's generic
  "response pending" marker ([[module-extension-api]]). Changing either breaks ThinkRail's card and its
  restart repair.

## Decisions

- **One option is allowed, for one purpose.** Validation accepts 1–4 options so an inference can be
  confirmed with a single "Looks right": corrections arrive through Other, disagreement through discuss.
  The schema and guidance keep saying "2-4 options" and name the exception, so the model does not read the
  minimum as an invitation.
- **Discuss is an answer, not an escape.** A question marked "discuss first" is answered with
  `kind: "discuss"`; the envelope renders it as `"Q"=(the user wants to discuss this question first:
  <reason>)` plus the notes, and appends one instruction: do not guess those answers, explain each in plain
  words, ask again in a later round. The result is an ordinary `answered` outcome — never an error, never
  `terminate` — even when every question is marked, so the agent explains in the same turn (unconfirmed
  with the user; both design reviews agreed). "Chat about this" stays the deferral that ends the turn.
- **Two preview levels.** A question's own preview is its subject (the design to approve, the current
  state); it is shown above the options and never echoed back, because the model wrote it. Option previews
  compare alternatives and stay single-select only; an option may honestly have none.
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
  - Same keys: ↑↓ only move; Enter picks an option (single-select) or checks / unchecks it
    (multi-select) and never moves on; Space opens the option's note (picking it first); `d` on an option
    row (never inside an editor, never on the Other row) marks the question "discuss first" and opens its
    editor; Tab / → and Shift+Tab / ← page; Ctrl+Enter submits where the terminal reports it (Kitty CSI-u
    or modifyOtherKeys — elsewhere it arrives as a plain Enter and picks); Esc skips (the card's skip is
    Shift+Esc because the chat composer owns plain Escape).
  - Rows: the options, a `✎` row under an option with a saved note, a `?` discussion row above the options
    while the question is marked, Other (typing on its row starts its editor), **Next →** on earlier pages
    or **Submit answers** on the last page (single-question rounds included), and "Chat about this".
    Editors save on Enter or Esc without confirming and park the cursor on their own row, where Enter
    reopens them — so a second Enter never changes the answer. The cursor is kept per page as a row key,
    so rows appearing above it never move it.
  - A single-select note follows the selection; a marked question's tab shows ` ?`; the "Recommended"
    badge and the `Why:` line; one page per question and no review page, the unanswered sent as not
    answered.
  - The question preview prints above the options; the option preview follows the cursor (beside the list
    from 100 columns, below it otherwise, capped at 24 lines; a file preview prints `preview: <path>`, and
    "No preview for this option" otherwise — also for an own answer).
  - Known limit: no viewport for a questionnaire taller than the terminal.
- **The dialog walker trades richness for reach.**
  - One `select` per question, with "Other…", "Discuss this…" and "Chat about this"; "Discuss this…" then
    asks an `input` for the optional text.
  - Multi-select is a single `input` of "1,3; own text"; a leading `?` marks the question for discussion
    with the rest as its text. One input keeps the walker to one dialog per question, where a separate
    select first would double the dialogs of every multi-select question.
  - The question preview and file paths go into the title (600 characters). No notes, reasons or review
    page.
  - Dismissing any dialog declines the whole questionnaire.
- **One ask per batch.** A `message_end` hook keeps the first ask as the only tool call, because pi's
  sequential-abort hole leaves unexecuted siblings without results. The model re-issues them after the
  answer. The tool is `sequential` and `model-only`, so codemode scripts cannot call it.
- **No cap on the number of questions; length limits are advisory.** The limits live in field descriptions
  only: a schema `maxLength` would reject the whole call and echo every argument back. Reserved labels
  ("Other", "Type something.", "Chat about this", "Discuss this…", "Next →") are rejected because the UIs
  add them.

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
