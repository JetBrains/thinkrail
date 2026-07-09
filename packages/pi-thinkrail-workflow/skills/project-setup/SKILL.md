---
name: project-setup
description: "Start here to set up or onboard a project's specs — draft its first goal-and-requirements.md, architecture.md, and module specs. The front door that detects whether the workspace is a brand-new/empty project or an existing codebase with no specs, then routes to the right flow. Use whenever asked to set up, onboard, initialize, or spec a project."
---

# Project setup — dispatcher

The single entry point for turning a project into a spec graph. Figure out which situation you're in, then
follow the matching skill — don't improvise the flow yourself.

## 1. Detect

Look at the workspace and use the spec tools (`spec_grep` / `spec_graph`):

- Is there already a spec graph (a `goal-and-requirements.md` or any `SPEC.md`)?
- Is there real source code, or is the repo empty / near-empty (just a README or scaffolding)?

## 2. Route

| Situation | Follow |
|---|---|
| **Already has specs** | Don't redo it. Briefly offer to review/extend the graph (fill obvious gaps — a missing `architecture.md`, un-specced modules) or point at the `brainstorming` skill for feature work, then stop. |
| **No specs · empty / near-empty repo** | The **`project-new`** skill — interview the user to turn the idea into `goal-and-requirements.md`. |
| **No specs · real source code** | The **`project-import`** skill — analyze the code + agent files and draft the first spec graph, asking only for intent the code can't reveal. |

Read and follow that skill's steps.

## The bar (applies to every flow)

Keep every spec **short, honest, and on-rails**: small enough for a human to read, high-signal enough to
keep a future agent on track. Explain intent, not a file inventory; say each thing once. New specs are
`status: draft` until the user reviews them.
