# @thinkrail/pi-ask-user-question

A [pi](https://pi.dev) extension that gives the agent an `ask_user_question` tool. Instead of guessing, the
agent asks you one or more structured multiple-choice questions and waits for your answers.

```bash
pi install npm:@thinkrail/pi-ask-user-question
```

## What you get

- **`ask_user_question` tool.** Each question has a short `header`, two to four options (`label`,
  `description`, an optional markdown `preview`, and an optional `recommendedReason` for the option marked
  `(Recommended)`), and `multiSelect` when several answers are valid. A question can carry its own
  markdown `preview` — what the question is about, such as the design being approved — shown above the
  options. A single option is allowed for one purpose: confirming an inference ("Looks right"). One call
  carries every question the agent can ask now. The run pauses until you answer.
- **A questionnaire in the terminal.**
  - One page per question: **Next →** (or Tab / →) moves on, Shift+Tab / ← goes back. **Submit answers**
    on the last page — or Ctrl+Enter anywhere, where the terminal reports it — sends what you have
    answered so far.
  - ↑↓ only move; Enter picks an option (checks or unchecks it in multi-select) and never moves on.
  - **Other** for your own answer: type on its row; Enter or Esc in its editor keeps the text.
  - Space attaches a note to an option (picking it first); the saved note gets its own row, and in
    single-select the note follows your choice.
  - `d` marks the question **discuss first**, with an optional line on what to explain; the agent then
    explains the question instead of guessing and asks it again later. Choosing an option cancels it.
  - The recommended option shows a `Why:` line.
  - The question's preview prints above the options. An option's preview appears beside the list on wide
    terminals and below it on narrow ones; an option without one says so.
  - Esc skips the questionnaire. **Chat about this** ends the turn so you can answer in your own words.
- **Dialogs in RPC hosts.** In editors that drive pi over RPC (VS Code, Zed, …) the questions arrive one
  native dialog at a time: a choice list with "Other…", "Discuss this…" and "Chat about this". A
  multi-select question takes the numbers of the options you pick (`1,3`), optionally followed by
  `; your own answer`, or `?` and a note to discuss it first.
- **Readable answers.** The tool result tells the model exactly what you chose, your own answers, your
  notes, the questions to discuss first, and which questions you left unanswered. The transcript shows a
  compact summary.

Without an interactive UI (`pi -p`, JSON mode) the tool reports that it cannot ask, so the agent states its
assumptions instead.

## Embedding

Hosts with their own question UI can keep the tool and replace how it asks:

```ts
import { createAskUserQuestionExtension } from "@thinkrail/pi-ask-user-question";

export default createAskUserQuestionExtension({
  // Show request.args in your UI and resolve with the person's answer:
  // { kind: "answered", result }, { kind: "deferred" } (the answer arrives as a chat message)
  // or { kind: "abandoned" }. Reject to report the run as stopped.
  ask: async (request) => myHost.ask(request.toolCallId, request.args, request.signal),
  // Optional: learn about each executable call before pi runs it.
  announce: (toolCallId) => myHost.expect(toolCallId),
  // Optional: describe your UI to the model.
  guidance: { description: "…", promptGuidelines: ["…"] },
  // Optional: let previews name workspace files (previewFile / previewBefore) your UI can render, and
  // check each path before the question is shown. Off by default: terminals and dialogs print the path.
  filePreviews: true,
  checkFile: async (path, cwd) => assertInsideWorkspace(path, cwd),
});
```

`@thinkrail/pi-ask-user-question/core` exports the schema-independent pieces such a host needs outside the
tool: the result types, the model-facing envelope builder, the acknowledgement text and the validation.

## License

Apache-2.0 — part of [ThinkRail](https://thinkrail.ai/?utm_source=pi-package&utm_medium=referral&utm_campaign=pi-ask-user-question&utm_content=readme).
