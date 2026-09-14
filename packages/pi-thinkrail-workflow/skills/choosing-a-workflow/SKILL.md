---
name: choosing-a-workflow
description: "Use for project onboarding, any PR lifecycle work including PR checks, or changes that require choosing product scope, user-visible behavior, or architecture. Not for non-PR questions, checks, explanations, or localized fully specified work."
---

# Choosing a Workflow

The root router of the workflow family in `packages/pi-thinkrail-workflow`. It classifies
workflow-eligible work and names the workflow skill that governs it — nothing more. A routed skill's
steps live in that skill alone; read it, don't run it from memory.

## Classify

Read the request and use what is already known to answer three questions:

1. **Is this project onboarding?** No spec graph yet — an empty or effectively empty workspace where
   the user brings a raw idea, or an existing codebase being set up or specced for the first time.
2. **Is this the PR lifecycle?** Finished work shipping as a pull request, or an existing PR being
   tended — created, brought up to date, given screenshots, its checks watched, or its review comments
   addressed. Fixes that flow from a PR's own review comments belong here.
3. **Does the work require a product or design choice?** The request leaves scope, user-visible
   behavior, or architecture to decide before implementation.

If none applies, no workflow is needed: proceed directly without a workflow announcement. A fully
specified fix, mechanical refactor, documentation or configuration-only change, question,
explanation, or check normally belongs here.

If the route is genuinely ambiguous from the request alone, ask one short clarifying question
(`ask_user_question`, composed per the **asking-user-questions** concept skill) rather than guessing.

## Route

| Classification | Route |
|---|---|
| Project onboarding — no spec graph yet | Read and follow **setting-up-a-project** |
| PR lifecycle work | Read and follow **shipping-a-pr** |
| A change requiring a product or design choice | Read and follow **brainstorming** |
| None of the above | No matching workflow; proceed directly without announcing the routing result |

One route per piece of work. If a request bundles unfinished implementation with PR work, route the
implementation first and return to **shipping-a-pr** only after it lands.

## Red flags — stop and re-route

- You started implementation while a required product or architecture choice is still unresolved.
- You loaded **brainstorming** for work whose observable result and implementation constraints are
  already specified.
- You are following a routed skill's steps from memory instead of reading that skill.

## Handoff

This skill ends by naming exactly one of: **setting-up-a-project**, **shipping-a-pr**,
**brainstorming**, or **no matching workflow** (proceed directly). Adding a workflow to the family
adds a row to the table above — see the **writing-workflow-skills** skill.
