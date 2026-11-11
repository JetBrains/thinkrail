---
"@thinkrail/pi-ask-user-question": minor
---

Questions can be marked **discuss first** — `d` in the terminal, **Discuss this…** in RPC dialogs (`?` in a
multi-select input) — with an optional note; the model is told not to guess those answers but to explain
the question and ask it again later. A question can carry its own markdown `preview` shown above its
options, an option without a preview now says so instead of showing another option's preview, a note
follows the selection in single-select, and a single "Looks right" option is accepted for confirming an
inference. Hosts that render files can opt into `filePreviews` (`previewFile` / `previewBefore`) with a
`checkFile` hook; the selected file preview reaches the model as a path, never its content.

The terminal questionnaire's keys change to match ThinkRail's card: ↑↓ only move, **Enter picks or
checks** an option and never moves on, **Space adds a note** (replacing `n`), **Next →** / Tab / → move
to the next question, and **Submit answers** — now also on single-question rounds — or **Ctrl+Enter**
(where the terminal reports it) sends. A saved note and a discussion mark become rows of their own, so
a second Enter reopens them instead of changing the answer.
