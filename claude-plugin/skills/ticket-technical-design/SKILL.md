---
name: ticket-technical-design
description: Produce the technical-design.md artifact for a meta-ticket. Reads product-design.md, asks technical clarifying questions, proposes 3-5 architectural approaches with trade-offs, presents the technical design section by section, self-reviews across both designs, writes the file. Use when a ticket is in the `product-design` state.
icon: "🏛️"
group: Ticket
requires: ticket
argument-hint: "[ticket-context]"
---

# Ticket: Technical design (product-design → technical-design)

You are running the **technical design** phase. This step produces `{{TR_DIR}}/tickets/{id}/technical-design.md` and concludes with a self-review across `product-design.md` + `technical-design.md`.

## Quick reference

| Tool | Use for |
|---|---|
| `Write` | Initial skeleton (only when creating from scratch) |
| `SetPreviewFile` / `ClearPreviewFile` | Show the artifact-in-progress beside the chat |
| `LabelArtifact` | Annotate the artifact for the right-panel chip strip (optional) |
| `Edit` | Fill each section (standard edit approval) |
| `AskUserQuestion` | Clarifying questions, "evolve vs from scratch" branching, architectural-approach picking — never section content |
| `thinkrail_visualize` | Architectural-approach comparison, diagrams |
| `SessionFinalize` | Finalize the stage after the user confirms — hands control back to the orchestrator, which verifies the artifact and advances the pipeline |
| `spec_search` | Discover existing architecture / module specs |
| `Read` | Read `product-design.md` and relevant project specs |
| `TodoWrite` | Surface the workflow as live tasks in the ticket's "Tasks (n/m)" sub-row (call once at the start; re-emit after each task to update statuses) |

## Process

0. **Initialize task list** — call `TodoWrite` ONCE with the 13 items below; first item (`Examine context`) goes `in_progress`. Re-emit the full list after each task completes, marking the previous task `completed` and the next `in_progress`. The frontend reads the latest snapshot and renders it as the "Tasks (n/m)" sub-row in the phase tree.

   ```
    1. Examine context
    2. Ask technical clarifying questions
    3. Compare architectural approaches
    4. Write document skeleton
    5. Draft section: Architecture overview
    6. Draft section: Components
    7. Draft section: Interfaces / contracts
    8. Draft section: Data flow
    9. Draft section: Error handling
   10. Draft section: Testing strategy
   11. Draft section: Validation criteria
   12. Self-review document
   13. Finalize the stage
   ```

1. **Examine context** *(task #1)* — `Read` `product-design.md` from `{{TR_DIR}}/tickets/{id}/`. Read related `{{TR_DIR}}/design_docs/` to understand current architecture.

2. **Staleness branch.** If `technical_design_stale: true` on the ticket, ask via `AskUserQuestion`: "Existing technical design is marked stale. Revise from scratch or evolve the existing one?"
   - *Evolve* — the file already exists; skip the skeleton task (mark task #4 `completed` immediately). Use `Edit` against the existing section content directly. The `old_string` is the section's current text (not a `<!-- pending -->` marker).
   - *From scratch* — proceed with the full task list.

3. **Ask technical clarifying questions** *(task #2)* one at a time via `AskUserQuestion`: stack choices, components, interfaces, data flow, error handling, testing, validation. Prefer multiple-choice with `Other:`.

4. **Compare architectural approaches** *(task #3)* in chat — propose 3-5 approaches with description, pros/cons, optional `thinkrail_visualize`, recommended choice. The user picks one. This is conversation, not a file change; do not edit files for the comparison itself. The chosen approach informs the content of the Architecture overview and Components sections written next.

5. **Write the skeleton** *(task #4)* (only on the from-scratch path) to `{{TR_DIR}}/tickets/{id}/technical-design.md` via `Write`. Use this template:

   ```markdown
   ---
   ticket_id: {id}
   kind: technical_design
   created: {timestamp}
   updated: {timestamp}
   ---

   # Technical design: {title}

   ## Architecture overview

   <!-- pending -->

   ## Components

   <!-- pending -->

   ## Interfaces / contracts

   <!-- pending -->

   ## Data flow

   <!-- pending -->

   ## Error handling

   <!-- pending -->

   ## Testing strategy

   <!-- pending -->

   ## Validation criteria

   <!-- pending -->
   ```

6. **Open the preview** — `SetPreviewFile({ path: "{{TR_DIR}}/tickets/{id}/technical-design.md" })`. Optional: also call `LabelArtifact({ path: "{{TR_DIR}}/tickets/{id}/technical-design.md", role: "technical_design", label: "Technical design" })` so the chip strip shows "Technical design".

7. **For each section in order** (Architecture overview *(task #5)*, Components *(task #6)*, Interfaces / contracts *(task #7)*, Data flow *(task #8)*, Error handling *(task #9)*, Testing strategy *(task #10)*, Validation criteria *(task #11)*), mark the section's task `in_progress` via `TodoWrite`, then call `Edit({ file_path, old_string, new_string })`:

   ```json
   {
     "file_path": "{{TR_DIR}}/tickets/{id}/technical-design.md",
     "old_string": "## <Section>\n\n<!-- pending -->",
     "new_string": "## <Section>\n\n<content>"
   }
   ```

   After the user approves or denies the edit:

   - On approval: the edit applies (auto-logged by the backend); mark the section's task `completed` via `TodoWrite` and advance.
   - On deny: the tool result carries the user's reason. If it's actionable feedback, revise per the feedback and re-edit (keep the task `in_progress`). If the user indicates the section should be skipped/left as-is, mark the task `completed` and move on — leave the `<!-- pending -->` marker in place for the Self-review step to surface.

8. **Self-review** *(task #12)* — runtime check that surfaces findings in chat, not a doc section.
   1. `Read` `product-design.md` and the in-progress `technical-design.md`. Cross-check for:
      - Placeholders (`<!-- pending -->`, `TODO`, `TBD`).
      - Sections that contradict each other or contradict the product design.
      - Ambiguities — anything a competent implementer would have to guess at.
      - Missing pieces — concerns named in PD that the TD doesn't address.
   2. Report findings in chat as a short list (one bullet per issue). If there are no issues, say "Self-review: clean."
   3. Ask via `AskUserQuestion`: "Self-review found N issues. How do you want to proceed?" Options:
      - *Address now* — fix each issue via `Edit` calls, then mark task #12 `completed` and continue. (Re-run the check if many issues are clustered in one section.)
      - *Accept and proceed* — mark task #12 `completed` without changes; the issues become known limitations.
      - *Cancel transition* — leave the ticket where it is for manual work.
   - Do NOT write a "Self-review" section into the document. The doc records the design, not the review.

9. **Finalize the stage** *(task #13)*
   1. **`ClearPreviewFile()`**.
   2. **Confirm with the user** via `AskUserQuestion`: "Technical design looks complete. Finalize this stage and hand control back to the orchestrator?" If yes, call `SessionFinalize` with the artifact and a one-line summary:
      ```json
      {
        "summary": "Technical design complete — technical-design.md drafted and self-reviewed.",
        "artifacts": [{ "path": "{{TR_DIR}}/tickets/{id}/technical-design.md", "label": "Technical design" }]
      }
      ```
   You do **not** advance the ticket yourself. Finalizing ends this stage and automatically resumes the orchestrator, which reviews your artifact, adjusts the pipeline if needed, and starts the next stage (`amend-specs`).

## Guidelines

- This is the **technical** phase. The product design is fixed input.
- Always propose multiple architectural approaches before settling — that comparison happens in chat, not via file edits.
- Skeleton is written first via `Write` (from-scratch path); every section after that is filled with `Edit` — the standard edit approval prompt is the section-approval surface.
- Self-review is a runtime check, not a doc section: surface findings in chat via `AskUserQuestion`, address with `Edit` if the user wants. Do not write a "Self-review" section into the technical-design document. Blocking issues do not finalize until the user explicitly accepts them.
- Save the artifact under `{{TR_DIR}}/tickets/{id}/`; `Write` creates parent directories.

## Red flags — STOP

- About to use `AskUserQuestion` to approve a section's *content*? STOP. The standard edit approval prompt is the section-approval surface. `AskUserQuestion` is for clarifying questions and the "evolve vs from scratch" + architectural-approach branching choices only.
- About to fill multiple sections in one `Edit` call? STOP. Per-call should cover one section; bundling makes the diff ambiguous.
- About to commit during the skill? STOP. These drafting skills do not commit at all. Commits happen later — only when the amend-specs stage completes, where the board service commits the accumulated spec changes + the patch log.
- `<!-- pending -->` marker still in the file when you're about to finalize? STOP. That section is unfilled. Either fill it or remove the marker explicitly via `Edit`.
- Blocking issues in self-review and you're about to finalize anyway? STOP. Self-review is a hard gate; surface the issues in chat and propose the user goes back to revise.
- Drafting a section without first marking its task `in_progress` via `TodoWrite`? STOP. The Tasks (n/m) sub-row stalls — users can't see what you're working on.
- About to call `TodoWrite` only once (at the start)? STOP. You must re-emit after each task to update statuses; the frontend reads the latest snapshot per session.
