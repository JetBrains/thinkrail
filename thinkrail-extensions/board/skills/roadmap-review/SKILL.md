---
name: roadmap-review
description: "Use when the user asks to review or replan the roadmap of a ThinkRail board — which initiatives to move between Now, Next and Later, trim or defer — including a `/skill:roadmap-review` kickoff from the board's Roadmap review."
---

# Reviewing the roadmap

Review every open initiative against the data and propose changes; apply only what the human confirms,
one decision at a time.

## Steps

1. **Read every initiative** the kickoff lists with `board_initiative_get` (batch the calls): health
   reasons, forecast against target, progress, blocked cards, waits for the human, appetite used.
2. **Find the pressure points:**
   - forecast (85 %) past the target;
   - blocked chains and the initiatives they hold up;
   - cards waiting on the human — the human's attention is the scarcest resource;
   - WIP: too much in Now, Review over its limit, agents idle while Now is empty;
   - appetite past 80 % with criteria still open.
3. **Propose a list**, each item one change with the data behind it: move a horizon (Now ↔ Next ↔
   Later), trim scope (a criterion or cards to drop — scope hammering), or defer. Order by impact.
4. **Confirm each** with `ask_user_question` (one question per proposal, options apply / skip).
5. **Apply only the confirmed.** Horizon moves: `board_initiative_move { initiativeId, horizon }`. For
   trims and deferrals, tell the human exactly which criteria or cards to change on the board.
6. **Summarize** what changed and what was left as is.

## Red flags

- Moving anything before the human confirmed that exact change.
- A proposal without the data that motivates it.
- Recommending more work in Now while the human already has waits piling up.
- Editing cards or initiatives' text — out of this skill's reach.
