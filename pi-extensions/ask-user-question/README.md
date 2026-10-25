# @thinkrail/pi-ask-user-question

A [pi](https://pi.dev) extension that gives the agent an `ask_user_question` tool. Instead of guessing, the
agent asks you one or more structured multiple-choice questions and waits for your answers.

```bash
pi install npm:@thinkrail/pi-ask-user-question
```

## What you get

- **`ask_user_question` tool.** Each question has a short `header`, two to four options (`label`,
  `description`, an optional markdown `preview`, and an optional `recommendedReason` for the option marked
  `(Recommended)`), and `multiSelect` when several answers are valid. One call carries every question the
  agent can ask now. The run pauses until you answer.
- **A questionnaire in the terminal.**
  - One page per question, then **Review & submit**.
  - ↑↓ to move (in single-select this also selects), Space to toggle in multi-select, Enter to confirm.
  - **Other** for your own answer: type on its row.
  - `n` attaches a note to an option.
  - The recommended option shows a `Why:` line.
  - An option's markdown preview appears beside the list on wide terminals and below it on narrow ones.
  - Esc skips the questionnaire. **Chat about this** ends the turn so you can answer in your own words.
- **Dialogs in RPC hosts.** In editors that drive pi over RPC (VS Code, Zed, …) the questions arrive one
  native dialog at a time: a choice list with "Other…" and "Chat about this". A multi-select question
  takes the numbers of the options you pick (`1,3`), optionally followed by `; your own answer`.
- **Readable answers.** The tool result tells the model exactly what you chose, your own answers, your
  notes, and which questions you left unanswered. The transcript shows a compact summary.

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
  // Optional: describe your UI to the model.
  guidance: { description: "…", promptGuidelines: ["…"] },
});
```

`@thinkrail/pi-ask-user-question/core` exports the schema-independent pieces such a host needs outside the
tool: the result types, the model-facing envelope builder, the acknowledgement text and the validation.
