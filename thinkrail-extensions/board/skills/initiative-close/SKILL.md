---
name: initiative-close
description: "Use when the user wants to close a finished roadmap initiative on the ThinkRail board — verify it against its success criteria, update the goal spec's capabilities and file its deferrals — including a `/skill:initiative-close` kickoff from the initiative's Close initiative."
---

# Closing an initiative

Close the loop: check the initiative is really done, reflect it in the goal spec, keep its deferred
work, and mark it closed only once the human confirms.

## Steps

1. **Verify.** `board_initiative_get { initiativeId }`. For each success criterion, say met / not met
   with the cards (and PRs) as evidence. Open cards that matter → stop and ask whether to close anyway.
2. **Propose the spec edit.** Find the owner of the capability it delivers: the goal-and-requirements
   spec's Capabilities list by default, else the spec (or OpenSpec change) that owns it
   (`spec_search` / `spec_get`). Show the edit as a unified diff in the chat — one clause, the spec's
   own voice, no restating of other specs.
3. **On approval**, make exactly that edit in this workspace and suggest the human opens a PR for it.
   Never commit or push yourself.
4. **Keep the deferrals.** Take the deferrals `board_initiative_get` lists from its cards' task-specs (and
   any the human adds) and file them with one `board_cards_create_batch` into Triage. Skip none silently.
5. **Confirm, then close.** Ask with `ask_user_question` whether to mark it closed; only on yes call
   `board_initiative_close { initiativeId }`.
6. **Summarize**: criteria met, the spec edit and its PR suggestion, the deferrals filed.

## Red flags

- Closing before the human confirmed, or with unmet criteria unmentioned.
- Editing a spec before the diff was approved, or editing anything beyond it.
- Dropping a deferral instead of filing it.
- Committing, pushing or opening the PR yourself.
