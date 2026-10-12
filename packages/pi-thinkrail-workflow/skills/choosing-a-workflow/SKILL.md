---
name: choosing-a-workflow
description: "Use at the start of new project onboarding, PR lifecycle work including PR checks, or any change to what the product does — a feature, a behavior change, or a bug fix. Not for continuing work already routed to a workflow, non-PR questions, checks, explanations, or edits that change no behavior."
---

# Choosing a Workflow

The root router of the workflow family in `packages/pi-thinkrail-workflow`. It classifies new
workflow-eligible work and names the workflow skill that governs it — nothing more. Work already routed
resumes its active workflow instead. A routed skill's steps live in that skill alone; read it, don't run
it from memory.

## Classify

For a new piece of work, read the request and use what is already known to answer three questions:

1. **Is this project onboarding?** No spec graph yet — an empty or effectively empty workspace where
   the user brings a raw idea, or an existing codebase being set up or specced for the first time.
2. **Is this the PR lifecycle?** Finished work shipping as a pull request, or an existing PR being
   tended — created, brought up to date, given screenshots, its checks watched, or its review comments
   addressed. Fixes that flow from a PR's own review comments belong here.
3. **Does the work change what the product does?** A new feature, a change in behavior, or a bug
   fix — however small, and even when the request already spells out the design. A detailed request
   shortens the interview; it never skips it.

If none applies, no workflow is needed: proceed directly without a workflow announcement. Only work
that changes no behavior belongs here: a non-PR question, explanation, or check; a typo, documentation, or
configuration-only edit; a mechanical refactor such as a rename.

If the route is genuinely ambiguous from the request alone, ask one short clarifying question
(`ask_user_question`, composed per the **asking-user-questions** concept skill) rather than guessing.

## Route

| Classification | Route |
|---|---|
| Project onboarding — no spec graph yet | Read and follow **setting-up-a-project** |
| PR lifecycle work | Read and follow **shipping-a-pr** |
| A feature, behavior change, or bug fix | Read and follow **brainstorming** |
| None of the above | No matching workflow; proceed directly without announcing the routing result |

One route per piece of work. If a request bundles unfinished implementation with PR work, route the
implementation first and return to **shipping-a-pr** only after it lands.

## Red flags — stop and re-route

- You started implementing a feature, behavior change, or bug fix without going through
  **brainstorming**.
- "It's small" or "the request is already specific" — neither is a reason to skip; the workflow
  scales down, it does not switch off.
- You loaded **brainstorming** for work that changes no behavior (a rename, a typo, a question).
- You re-entered this router while continuing work already assigned to a workflow.
- You are following a routed skill's steps from memory instead of reading that skill.

## Handoff

This skill ends by naming exactly one of: **setting-up-a-project**, **shipping-a-pr**,
**brainstorming**, or **no matching workflow** (proceed directly). Adding a workflow to the family
adds a row to the table above — see the **writing-workflow-skills** skill.
