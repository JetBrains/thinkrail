---
name: setting-up-a-project
description: "Use when asked to set up, onboard, initialize, or spec a project with no spec graph, or when invoked by the app's Set-up-project card. Not for ordinary work in an already-specced project."
---

# Setting up a project — dispatcher

The single entry point for turning a project into a spec graph. Figure out which situation you're in, then
follow the matching skill — don't improvise the flow yourself.

## 1. Detect

Look at the workspace and use the spec tools (`spec_grep` / `spec_graph`):

- Is there already a spec graph (a `goal-and-requirements.md` or any `SPEC.md`)?
- Is there real source code, or is the repo empty / near-empty (just a README or scaffolding)?

## 2. Route

| Situation | Follow |
|---|---|
| **Already has specs** | Don't redo it. Briefly offer to review/extend the graph (fill obvious gaps — a missing `architecture.md`, un-specced modules). For other work, use `brainstorming` only when product scope, user-visible behavior, or architecture remains to decide; otherwise proceed directly. Declined → stop. Accepted → **Graph extension** below. |
| **No specs · empty / near-empty repo** | The **`starting-a-new-project`** skill — interview the user to turn the idea into `goal-and-requirements.md`. |
| **No specs · real source code** | The **`importing-a-codebase`** skill — analyze the code + agent files and draft the first spec graph, asking only for intent the code can't reveal. |

Read and follow that skill's steps.

## Graph extension (no dedicated skill)

No dedicated skill covers extending an existing graph. If the offer is accepted, align and adapt to
the user's request with your own judgment, holding the **writing-specs** bar without a routing
announcement.

## Handoff

Ends by naming exactly one of: **starting-a-new-project**, **importing-a-codebase**, or — when specs
already exist — the review/extend offer above (declined → stop; accepted → graph extension on
judgment against the **writing-specs** bar).
