---
name: ticket-product-design
description: Produce the product-design.md artifact for a ticket. Asks product clarifying questions (purpose, user stories, value, product/feature success criteria, user scenarios, essence and product outcomes of the feature, feature delivery), presents the design section by section, writes the file, and updates the ticket body with a brief blurb. Use when a ticket is in the `idea` state.
icon: "✏️"
group: Ticket
requires: ticket
argument-hint: "[ticket-title-or-context]"
---

# Ticket: Product design (idea → product-design)

You are running the first step of the brainstorm-aligned ticket flow. This step is the **product design** phase. It produces `.bonsai/tickets/{id}/product-design.md` and a short blurb for the ticket body (kanban card and detail header).

## Quick reference

| Tool | Use for |
|---|---|
| `Write` | Initial skeleton (one call at the start) |
| `SetPreviewFile` / `ClearPreviewFile` | Show the artifact-in-progress beside the chat |
| `LabelArtifact` | Annotate the artifact for the right-panel chip strip (optional) |
| `ProposeChange` | Fill each section with user approval (4-button card) |
| `SuggestDescription` | Update the ticket body blurb (unchanged) |
| `AskUserQuestion` | Clarifying questions and branching choices — never section content |
| `ChangeTicketStatus` | Transition to `technical-design` after confirmation (status === ongoing work; PD work is done, next phase becomes active) |
| `TodoWrite` | Surface the workflow as live tasks in the ticket's "Tasks (n/m)" sub-row (call once at the start; re-emit after each task to update statuses) |


## Process

0. **Initialize task list** — call `TodoWrite` ONCE with the 12 items below; first item (`Examine context`) goes `in_progress`. Re-emit the full list after each task completes, marking the previous task `completed` and the next `in_progress`. The frontend reads the latest snapshot and renders it as the "Tasks (n/m)" sub-row in the phase tree.

   ```
    1. Examine context
    2. Ask clarifying questions
    3. Update ticket description
    4. Write document skeleton
    5. Draft section: Goal
    6. Draft section: User stories
    7. Draft section: User requirements
    8. Draft section: Product value
    9. Draft section: Success criteria
   10. Draft section: Validation criteria
   11. Self-review document
   12. Finalize and transition
   ```

1. **Examine the context** *(task #1)*: **Read project context** — current ticket title + any existing body, plus relevant `.bonsai/design_docs/` files. Do not waste time on areas unrelated to the request.
2. **Ask product clarifying questions** *(task #2)* via `AskUserQuestion` — purpose, user stories, design, user experience, user requirements, product and feature value, product/feature success criteria, product/feature validation criteria. You goal for this step is to extract intent the user has. Prefer multiple-choice with a free-form `Other:` option. Always show your recommendation and explanation. All connected questions must be asked one at a time. Stop only when the picture is completely clear.
3. **Update description** *(task #3)*: **Update the ticket body** via `SuggestDescription` with a short human-oriented blurb (What / Purpose, ~3-6 lines). Pass `apply: true` when the user says "just write it". If you forget this step, the backend auto-fills the body from the first paragraph of the markdown — explicit is better.
4. **Create product design document**:
   1. **Write the skeleton** *(task #4)* to `.bonsai/tickets/{id}/product-design.md` via `Write`: see template below. Note, it is just a default template that ought to be adjusted to user's case and intent.
   2. **Open the preview** — `SetPreviewFile({ path: ".bonsai/tickets/{id}/product-design.md" })`. The right Context Panel switches to the Preview tab. Optional: also call `LabelArtifact({ path: ".bonsai/tickets/{id}/product-design.md", role: "product_design", label: "Product design" })` so the chip strip shows "Product design" instead of the raw filename.
   3. **For each section in order** (Goal *(task #5)*, User stories *(task #6)*, User requirements *(task #7)*, Product value *(task #8)*, Success criteria *(task #9)*, Validation criteria *(task #10)*), mark the section's task `in_progress` via `TodoWrite`, then call `ProposeChange`:
      ```json
      {
      "file_path": ".bonsai/tickets/{id}/product-design.md",
      "old_string": "## <Section>\n\n<!-- pending -->",
      "new_string": "## <Section>\n\n<content>",
      "section": "<Section>",
      "rationale": "..."
      }
      ```
      After the user resolves the card, mark the section's task `completed` via `TodoWrite` and advance to the next section.
   - On `applied: 'original' | 'edited'`: mark task `completed`, move on. The Preview tab updates automatically.
   - On `discuss: true`: keep task `in_progress`. Revise the proposal per `feedback` and re-propose. Don't re-propose the identical text.
   - On `discuss: false` (reject): mark task `completed` (the user explicitly chose to skip). Leave the `<!-- pending -->` marker in place — the Self-review step will surface it.
5. **Self-review** *(task #11)* — runtime check that surfaces findings in chat, not a doc section.
   1. `Read` the in-progress `product-design.md`. Cross-check for:
      - Placeholders (`<!-- pending -->`, `TODO`, `TBD`).
      - Sections that contradict each other (e.g. user stories vs success criteria).
      - Ambiguities — anything a TD-phase implementer would have to guess at.
      - Missing pieces — purpose stated but stories absent, value claimed but no success criteria, etc.
   2. Report findings in chat as a short list (one bullet per issue). If there are none, say "Self-review: clean."
   3. Ask via `AskUserQuestion`: "Self-review found N issues. How do you want to proceed?" Options:
      - *Address now* — emit `ProposeChange` calls fixing each issue, then mark task #11 `completed` and continue.
      - *Accept and proceed* — mark task #11 `completed` without changes; issues become known limitations.
      - *Cancel transition* — leave the ticket where it is for manual work.
   - Do NOT write a "Self-review" section into the document.
6. **Finalize** *(task #12)*
   1. **`ClearPreviewFile()`** once all sections are filled.
   2. **Propose the state transition** via `AskUserQuestion`: "Product design looks complete. Shall I move the ticket to `technical-design`?" If yes, call `ChangeTicketStatus({ status: 'technical-design' })`. (Status === ongoing work: the UI flipped status to `product-design` when the user clicked Run; now that the work is done, we advance to the next phase.)

### Product design document template

Use this template but adjust it according to user's intension and needs:

```markdown
---
ticket_id: {id}
kind: product_design
---

# Product design: {title}

## Goal

<!-- pending -->

## User stories

<!-- pending -->

## User requirements

<!-- pending -->

## Product value

<!-- pending -->

## Success criteria

<!-- pending -->

## Validation criteria

<!-- pending -->
```


## Guidelines

- Skip the "propose 3-5 approaches" sub-step — describing is not multi-alternative.
- This is the **product** phase. Don't get technical (no architecture, no implementation choices). That comes in `ticket-technical-design`.
- The ticket body blurb is for the kanban card; the file is the full doc.
- Skeleton is written first via `Write`; every section after that goes through `ProposeChange` — this is the user's section-approval surface.
- Save the artifact under `.bonsai/tickets/{id}/`; `Write` creates parent directories.

## Red flags — STOP

- About to call `Edit` on `product-design.md` to fill a section? STOP. Use `ProposeChange` so the user can inline-edit, discuss, or reject before the write lands.
- About to use `AskUserQuestion` to approve a section's *content*? STOP. The 4-button `ProposeChange` card is the section-approval surface now. `AskUserQuestion` is for clarifying questions and branching choices.
- About to fill multiple sections in one `ProposeChange` call? STOP. Per-call should cover one section. The `section` field labels the card; bundling makes the card ambiguous.
- About to commit during the skill? STOP. These drafting skills do not commit at all. Commits happen later, only on amend-specs → implementation-plan transitions, via `BoardService.on_status_change`.
- `<!-- pending -->` marker still in the file when you're about to transition? STOP. That section is unfilled. Either fill it or remove the marker explicitly via `ProposeChange`.
- Drafting a section without first marking its task `in_progress` via `TodoWrite`? STOP. The Tasks (n/m) sub-row stalls — users can't see what you're working on.
- About to call `TodoWrite` only once (at the start)? STOP. You must re-emit after each task to update statuses; the frontend reads the latest snapshot per session.
