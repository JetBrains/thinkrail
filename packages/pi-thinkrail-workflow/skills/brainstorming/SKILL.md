---
name: brainstorming
description: "Use before implementing a feature, a change in behavior, or a bug fix — however small. Not for questions, checks, or edits that change no behavior (typos, documentation or configuration only, mechanical refactors)."
---

# Brainstorming

## Interview before you build

- Every feature, behavior change, or bug fix goes through this workflow. Depth scales with the
  change and never drops to zero: a small change gets one short round and a few lines of task-spec.
- The aim is a design the user understands and has accepted, recorded in a spec-graph `task-spec`,
  built, and then reflected in the durable specs — not a speculative implementation.
- Do not implement until the design is accepted. An explicit design or acceptance criteria in the
  request count as approval of what they cover; build on them and never re-ask them.

## Doc map

- `fixing-a-bug.md` — the bug branch (step 4).
- `amending-specs.md` — bringing the durable specs in line with what was built (step 9); the tail of
  both paths and where this workflow ends.

## The workflow

1. **Orient.** Use the spec-graph skill to find the specs that govern the area; read code second to
   confirm implementation details. Do not read unrelated specs. Note any non-obvious decision the
   change touches whose *why* is not recorded — it becomes a question in step 6.
2. **Scope check.** If the request bundles independent product decisions or subsystems, separate
   them rather than blending unrelated decisions into one task-spec.
3. **Open a task-spec.** `spec_create` a `task-spec` at **`.thinkrail/context/TASK-<slug>.md`** (id,
   title, status: draft, parent: the nearest relevant module). This gitignored file is the one
   temporary design artifact; update it as answers land.
4. **Bug?** When the request reports something that behaves wrongly, follow `fixing-a-bug.md` now;
   it returns here at step 5 (the "bug" is really a feature) or step 8.
5. **Product phase.** Interview what the change is for before how to build it: why it is needed,
   for whom, what the user will see and do — including empty, error, and edge states — and how we
   will know it is done. Ask in rounds per the **asking-user-questions** concept skill until no such
   decision is left assumed; look facts up instead of asking them. Record the answers in the
   task-spec's **Product** section, then confirm that understanding with one inference-confirmation
   question before any technical choice — skip only when the request itself supplied all of it.
6. **Technical phase.** Interview the technical decisions that the product answers leave open:
   constraints, compatibility, how the change will be verified, and the *why* of any decision noted
   in step 1. Compare approaches only when more than one viable approach remains — do not invent
   options once the constraints select one. Record the **Design** section: the chosen approach and
   why, trade-offs that matter, explicit deferrals.
7. **Self-review, then review once.** Remove placeholders, contradictions, accidental scope
   expansion, and ambiguous requirements; then present one cohesive design scaled to the change.
   Ask for approval only when the request has not already approved it; revise the task-spec if the
   user adjusts it.
8. **Build.** Implement against the accepted design. Before handoff, self-review the task diff: no
   silent lint/type suppressions, duplicated nontrivial derivations, rationale left as code
   comments, or remnants of a replaced pattern.
9. **Amend specs.** Follow `amending-specs.md`.

Skipped questions or a host with no question UI are not blockers: record the best assumption in the
task-spec as unconfirmed and continue.

## What a good task-spec looks like

- Scoped to one piece of work, sized to it — a few lines for a small change.
- **Request**, **Product** (or **Bug** for the bug branch), **Design**, unconfirmed assumptions, and
  explicit deferrals.
- Temporary: its durable content moves into the owning specs at step 9 instead of being copied.

## Red flags — stop

- You are editing source code before the design is accepted.
- "It's small" or "the request already says what to do" — the workflow scales down, it does not
  switch off.
- You offered technical options before the product phase was settled.
- You are about to hand off without step 9 — the specs drift from the code one skipped change at a
  time.

## Ending

`amending-specs.md` ends this workflow. PR lifecycle work, if requested, then enters
**shipping-a-pr** separately.
