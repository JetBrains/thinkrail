---
"@thinkrail/pi-ask-user-question": minor
---

Add `@thinkrail/pi-ask-user-question`: an `ask_user_question` tool for structured multiple-choice questions
that pause the run until the user answers. In the terminal it opens a questionnaire (one page per question,
review & submit, own answers, notes, markdown previews, recommended options, skip, and "chat about this"); in
RPC hosts it asks one dialog per question. Hosts can inject their own asker and wording through
`createAskUserQuestionExtension({ ask, guidance })`.
