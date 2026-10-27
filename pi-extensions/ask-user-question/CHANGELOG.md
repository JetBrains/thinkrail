# @thinkrail/pi-ask-user-question

## 0.1.0

### Minor Changes

- [#869](https://github.com/JetBrains/thinkrail/pull/869) [`565bf50`](https://github.com/JetBrains/thinkrail/commit/565bf50a2484fa66a3ddb08f7d090abbd807a527) Thanks [@danyaberezun](https://github.com/danyaberezun)! - Add `@thinkrail/pi-ask-user-question`: an `ask_user_question` tool for structured multiple-choice questions
  that pause the run until the user answers. In the terminal it opens a questionnaire (one page per question,
  review & submit, own answers, notes, markdown previews, recommended options, skip, and "chat about this"); in
  RPC hosts it asks one dialog per question. Hosts can inject their own asker and wording through
  `createAskUserQuestionExtension({ ask, guidance })`.
