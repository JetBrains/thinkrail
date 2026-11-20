---
name: roadmap-report
description: "Use when the user asks for a status update, progress report or weekly update of a roadmap initiative on the ThinkRail board — a `/skill:roadmap-report` kickoff from the board's Draft update included."
---

# Drafting an initiative update

Write the initiative's status update from the board's own data and save it as a draft. The human edits
and publishes it; you never publish.

## Steps

1. **Read the state.** `board_initiative_get { initiativeId }`: progress, health with its reasons,
   forecast, target and appetite.
2. **Read what moved.** `board_initiative_activity { initiativeId, sinceDays: 7 }` (or the period the user
   names): completions, starts, reviews, cards that did not move, progress notes.
3. **Write the update** in short markdown, facts first:
   - **Done** — what completed, by card;
   - **Stuck** — what is blocked, waiting for a human or failed, and why;
   - **Forecast** — the 50 % / 85 % dates against the target, or that there is not enough data;
   - **Next** — what should move next.
   No praise, no filler; every claim traceable to a card or a number.
4. **Suggest a health** — `on_track`, `at_risk` or `off_track` — from the forecast against the target
   and the health reasons, and say why in one line.
5. **Save** with `board_update_draft { initiativeId, text, health }` and tell the human it waits for
   them to edit and publish in the initiative's panel.

## Red flags

- Claims the activity or the initiative's data do not show.
- Hiding a late forecast or a blocked chain behind an optimistic health.
- Publishing, or asking to publish from the chat — only the human publishes.
