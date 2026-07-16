---
name: brainstorming
description: "Use this BEFORE any creative or feature work: building a new feature, adding functionality, changing behavior, or making a nontrivial design decision. Turns the user's request into a validated design — recorded as a spec-graph task-spec — before any implementation. Do not skip this because a change looks small."
---

# Brainstorming

## Brainstorm before you build

- Before starting any creative or feature work — a new feature, added functionality, a behavioral
  change, a nontrivial design decision — stop and run this workflow before writing implementation code.
- The aim: turn the request into a validated design, recorded as a spec-graph `task-spec`, that the user
  has explicitly approved — not a guess you implement and hope lands.
- Never implement during brainstorming. If you catch yourself opening a source file to make a change
  before the design is approved, stop.

## Anti-pattern: "this is too small to need this"

Every request goes through this, however small it looks. A one-line config change and a new subsystem
both benefit from a few minutes of "what does the user actually want and why" — that is where wrong
assumptions get caught cheaply. Scale the *depth* to the task; never skip the workflow entirely.

## The workflow

1. **Orient.** Use the spec-graph skill's tools first — `spec_grep`/`spec_get`/`spec_graph` — to find
   what the project already says about the area; read code second, to confirm details.
2. **Scope check.** If the request bundles multiple independent features or subsystems, say so and
   brainstorm them one at a time (or in parallel sub-sessions, the user's call) — don't blend unrelated
   decisions into one task-spec.
3. **Open a task-spec.** As soon as you understand roughly what's being asked, `spec_create` a
   `task-spec` at **`.thinkrail/context/TASK-<slug>.md`** (id, title, status: draft, parent: the nearest
   relevant module) to hold the design as it develops. `.thinkrail/context/` is the workspace's
   gitignored scratch dir (host-seeded, zero git footprint) yet stays scannable by the spec tools — the
   home for every temp doc, never committed. This file is the one artifact — update it live as decisions
   land; don't also keep a separate scratch doc. This works even in a project with no existing spec graph: a `task-spec` only needs
   frontmatter `id` and `type` to be a valid spec, no pre-existing graph required — don't skip this step
   just because nothing else in the project is specced yet.
4. **Clarify.** Ask what you need via `ask_user_question`, composing rounds per the
   **asking-user-questions** concept skill — read it before the first round. Resolve a full round,
   update the task-spec with what you learned, and only open a new round if the answers raised a
   genuinely new question. Per that concept's degradation norms, skipped questions or a host with no
   UI are not blockers: record your best-guess assumptions in the task-spec, explicitly marked
   unconfirmed, and continue.
5. **Propose approaches.** Once the ask is clear, write 2-3 approaches into the task-spec with
   trade-offs and a recommendation. When approaches are easiest to compare side by side, ask via a
   single-select `ask_user_question` with each approach as an option (label = approach name, description
   = its trade-off) instead of prose alone.
6. **Present the design.** Write it into the task-spec in sections scaled to their complexity; confirm
   with the user as each section lands, not only at the end.
7. **Self-review.** Before asking for final sign-off, reread the task-spec for: placeholders/TBDs,
   sections that contradict each other, scope that's actually multiple task-specs, and ambiguous
   requirements — fix what you find, don't just flag it.
8. **Promote.** When the design settles a boundary, contract, or decision that belongs in a durable
   spec, fold it into the relevant module's `SPEC.md` now — `spec_create` for a new module, `spec_update`
   for its frontmatter (draft → active as it firms up), `edit` for prose. Run `spec_validate` after
   structural changes.
9. **Final review, then build.** Ask the user to review the (now-promoted) design once more. Once
   approved, implement directly against it — there is no separate plan-writing step here. Keep the
   task-spec and the durable specs honest as the code lands, and retire the task-spec once **the work
   itself** is done, not merely once the design was promoted.

## What a good task-spec looks like

- Scoped to one piece of work — if it's accreting unrelated decisions, split it.
- States the request, the decision(s) made and why, the approaches considered and why they were or
  weren't picked, and anything the user explicitly deferred or declined to answer.
- Gets promoted, not copied: once a decision belongs in a module's `SPEC.md`, move it there and
  reference it from the task-spec rather than keeping two copies that can drift.
