---
name: choosing-a-workflow
description: "Use FIRST when any new piece of work arrives — a request, feature, change, fix, question, or idea — before starting on it or choosing an approach. Not for continuing work already routed to a workflow skill."
---

# Choosing a Workflow

The root router of the workflow family in `packages/pi-thinkrail-workflow`. It classifies the incoming
work and names the workflow skill that governs it — nothing more. A routed skill's steps live in that
skill alone; read it, don't run it from memory.

## Classify

Read the request and the workspace, then answer two questions — usually silently, from what is already
in front of you:

1. **Is this project onboarding?** No spec graph yet — an empty (or effectively empty) workspace where
   the user brings a raw idea, or an existing codebase being set up / specced for the first time.
2. **Does the work create or change anything in the project?** A new feature, added functionality, a
   behavior change, a nontrivial design decision — anything that alters what the project is or does.

If the route is genuinely ambiguous from the request alone, ask one short clarifying question
(`ask_user_question`) rather than guessing.

## Route

| Classification | Route |
|---|---|
| Project onboarding — no spec graph yet: an empty workspace with a raw idea, or an existing codebase to set up / spec | Read and follow **setting-up-a-project** — a dispatcher that routes on the workspace's state |
| The work creates or changes anything in the project — a new feature, added functionality, a behavior change, a nontrivial design decision | Read and follow **brainstorming** — however small it looks; that skill owns the "too small" judgment |
| Anything else — answering questions, explaining code, running commands or checks, work that changes nothing | **No matching workflow.** Say so in one line (e.g. "No workflow skill covers this; proceeding directly.") and proceed with your own judgment. Never stretch a route to fit — a forced route is worse than none. |

One route per piece of work. If a request bundles work from different rows (e.g. "explain X, then
change Y"), route the part that changes the project and handle the rest directly.

## Red flags — stop and re-route

- You started designing or editing before naming a route — routing comes first.
- You are following a routed skill's steps from memory instead of reading that skill.
- You classed a change as "anything else" because it looked small or mechanical — size is
  brainstorming's call, not the router's.

## Handoff

This skill ends by naming exactly one of: **setting-up-a-project**, **brainstorming**, or **no matching
workflow** (proceed with judgment). Adding a workflow to the family adds a row to the table above —
see the writing-workflow-skills skill.
