---
name: roadmap-plan
description: "Use when the user asks to plan or break down a roadmap initiative (or one of its roadmap projects) into board cards — a `/skill:roadmap-plan` kickoff from the board's Plan with agent included. Not for shaping an idea into an initiative (roadmap-shape) or for doing the work."
---

# Planning an initiative into cards

Decompose an accepted initiative into a sized, ordered set of cards that land in Triage as one group
the human accepts as a whole. Plan only: never start a card, never edit code.

## Steps

1. **Read the initiative.** `board_initiative_get { initiativeId }`: outcome, success criteria, horizon or
   target, appetite, projects, milestones and existing cards. Do not re-file what its cards already cover.
2. **Ground it.** Find the specs that govern the area (`spec_search`, then `spec_get` on the hits) and
   read the code they point at. Every card names the specs it touches.
3. **Shape the structure.** When the initiative has no roadmap project, propose one with
   `board_project_create { initiativeId, title, milestones }` — milestones are checkpoints a human can
   see, with target dates only when the initiative has a target.
4. **Decompose.** Each card: a one-line outcome title, a short why-and-what description with its spec
   ids, acceptance criteria, a size (S one sitting, M needs a short design, L needs design first — split
   anything bigger), type, and the cards it blocks. Cover the success criteria; nothing beyond them.
5. **File once.** One `board_cards_create_batch { roadmapProjectId, cards }` with `blocksIndex` for the
   order (no cycles). Never file the same plan twice; never call `board_card_create` per card.
6. **Report.** List the cards with sizes and the critical chain, what you left out and why, and that the
   human accepts the group in Triage.

## Red flags

- Starting a card, opening a workspace or editing code.
- Cards that restate a step of another card, or that no success criterion needs.
- An L card that could be split, or a card without acceptance criteria.
- Several batches or single-card calls for one plan.
- A plan that ignores the specs the code is governed by.
