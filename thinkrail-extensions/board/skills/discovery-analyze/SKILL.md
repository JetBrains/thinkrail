---
name: discovery-analyze
description: "Use when the user wants a discovery idea on the ThinkRail board analyzed into a value × effort score — against the goal spec, competitors and signals — with reasons and a suggested horizon; a `/skill:discovery-analyze` kickoff from the idea's Analyze included. Not for web research (discovery-research) or shaping an initiative (roadmap-shape)."
---

# Analyzing a discovery idea

Map the idea against the product's goals, the competition and the signals, then suggest a value, an
effort and a horizon, each with reasons the human can check. Suggest; the human decides.

## Steps

1. **Read the idea.** `board_ideas_list { ideaId }`: pitch, evidence (E-n) and any scores. A score
   marked as set by the human stays; analyze the rest.
2. **Ground it in the goal.** `spec_search` / `spec_get` the project's goal-and-requirements: which
   capability or principle it moves, and whether it breaks a non-goal. A non-goal it breaks caps value.
3. **Gap against competitors.** From its evidence (open the reports it links): what others offer, and
   what this would add or merely match.
4. **Signals.**
   - Session insights: only if a tool for them is available to you; there is none by default.
   - Product analytics: use the user's analytics MCP tools if configured.
   - Say which sources you could not reach; never invent numbers.
5. **Size the effort** from the code and specs it would touch (`spec_search`, reading the modules):
   new surfaces, migrations, unknowns.
6. **Score.** One `board_idea_score { ideaId, value: { score, reasons }, effort: { score, reasons },
   horizon: { horizon, reason } }`: 1 (low) to 5 (high); each reason one line that cites an evidence
   id, a spec or a signal. Horizon `now` only for high value at low effort or an urgent signal.
7. **Report** the scores and their weakest assumption, and what evidence would change them.

## Red flags

- Reasons that cite nothing, or a score that the reasons do not support.
- Overwriting or arguing with a score the human set.
- Claiming session-insight or analytics figures without a tool that returned them.
- Promoting the idea or filing initiatives and cards yourself.
