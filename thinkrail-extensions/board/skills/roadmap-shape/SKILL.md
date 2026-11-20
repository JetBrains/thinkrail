---
name: roadmap-shape
description: "Use when the user wants a raw idea turned into a roadmap initiative, or an initiative's outcome, criteria and scope shaped on the ThinkRail board — a `/skill:roadmap-shape` kickoff from the board's Shape with agent or a discovery idea's Promote included. Not for breaking an initiative into cards (roadmap-plan)."
---

# Shaping a roadmap initiative

Turn an idea into a bounded initiative the human can accept: why it matters, how to tell it is done,
what could swallow it and what it leaves out. Shape; never plan cards or start work.

## Steps

1. **Read the ground.** When the kickoff names an initiative, read it with `board_initiative_get`;
   a discovery idea (D-n, a Promote), with `board_ideas_list { ideaId }` — its pitch, evidence and
   scores. Read the project's goal-and-requirements spec (`spec_search` / `spec_get`): its capabilities,
   principles and non-goals.
2. **Ask what only the user can decide.** When a product decision is missing — who it is for, what
   done looks like, a hard deadline, what must stay out — ask with `ask_user_question` in one round.
   Look facts up instead of asking them.
3. **Shape.** Write:
   - **Outcome** — why it matters, in two or three sentences, tied to a goal-and-requirements
     capability (name it);
   - **Success criteria** — three to six checks a human can verify, not tasks;
   - **Rabbit holes** — the risks and unknowns that could blow up its size, each with how to avoid it;
   - **No-gos** — what is explicitly out, including anything a non-goal rules out;
   - **Horizon** — now, next or later, with one line why; an appetite in days only if the user gave one.
4. **Propose it.**
   - A new idea: `board_initiative_create_draft { title, outcome, criteria, horizon }`, the outcome
     followed by `Rabbit holes:` and `No-gos:` bullet lists, so every card's kickoff carries them;
     a discovery idea also passes its `ideaId`, which links the idea to the initiative.
   - An existing initiative: show the shaped text in the chat; the human edits the initiative.
5. **Hand off.** Say it is a proposal the human accepts on the board, and that `roadmap-plan` breaks it
   into cards once accepted.

## Red flags

- Criteria that read like tasks ("add a table") instead of checks ("a user can see …").
- An outcome that contradicts a non-goal, or ties to no capability without saying so.
- Filing cards, projects or milestones — that is `roadmap-plan`'s job.
- Guessing a product decision instead of asking it.
