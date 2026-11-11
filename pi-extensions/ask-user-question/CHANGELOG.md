# @thinkrail/pi-ask-user-question

## 0.2.0

### Minor Changes

- [#1149](https://github.com/JetBrains/thinkrail/pull/1149) [`4ea8a9f`](https://github.com/JetBrains/thinkrail/commit/4ea8a9f97e011041e6e61ff2e254640ece2a2aa6) Thanks [@rsolmano](https://github.com/rsolmano)! - The terminal questionnaire no longer ends on a **Review & submit** page: confirming the last question
  submits, and a **Submit answers** row on the last page sends whatever is answered. Questions left
  unanswered are still reported to the model as not answered.

### Patch Changes

- [#1162](https://github.com/JetBrains/thinkrail/pull/1162) [`c469b72`](https://github.com/JetBrains/thinkrail/commit/c469b724025b4e3f0719a701ffa74b4d2fe60812) Thanks [@rsolmano](https://github.com/rsolmano)! - The pi.dev gallery now shows a short terminal demo of each package, and the package description names
  ThinkRail as an example host.

## 0.1.0

### Minor Changes

- [#869](https://github.com/JetBrains/thinkrail/pull/869) [`565bf50`](https://github.com/JetBrains/thinkrail/commit/565bf50a2484fa66a3ddb08f7d090abbd807a527) Thanks [@danyaberezun](https://github.com/danyaberezun)! - Add `@thinkrail/pi-ask-user-question`: an `ask_user_question` tool for structured multiple-choice questions
  that pause the run until the user answers. In the terminal it opens a questionnaire (one page per question,
  review & submit, own answers, notes, markdown previews, recommended options, skip, and "chat about this"); in
  RPC hosts it asks one dialog per question. Hosts can inject their own asker and wording through
  `createAskUserQuestionExtension({ ask, guidance })`.
