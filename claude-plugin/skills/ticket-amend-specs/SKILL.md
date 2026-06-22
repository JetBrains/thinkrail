---
name: ticket-amend-specs
description: |
  Use when a ticket is in the `technical-design` state and the project
  specs under `{{TR_DIR}}/design_docs/*.md` need amending to reflect what the
  technical-design says. Symptoms: technical-design.md introduces concepts
  absent from existing specs, contradicts the current architecture, or
  adds new modules/submodules.
icon: "🔍"
group: Ticket
requires: ticket
argument-hint: "[ticket-context]"
---

# Ticket: Amend specs (technical-design → amend-specs)

You are amending the project's `{{TR_DIR}}/design_docs/*.md` files interactively, one file at a time, one section at a time, to reflect what the ticket's `technical-design.md` says. Each amendment is a standard `Edit`; in `default` mode the user approves it via the edit prompt (auto-applied in `acceptEdits`/yolo); every applied edit is appended (as a unified-diff hunk plus metadata header) to `{{TR_DIR}}/tickets/{id}/history.patch` automatically.

## Quick reference

| Tool | Use for |
|---|---|
| `Edit` | Every amendment to `{{TR_DIR}}/design_docs/*.md` |
| `SetPreviewFile` / `ClearPreviewFile` | Show the file under edit beside the chat |
| `LabelArtifact` | Annotate amended specs in the right-panel chip strip (optional) |
| `spec_search` | Discover which specs are relevant |
| `thinkrail_visualize` | Render the amendment plan |
| `AskUserQuestion` | Plan approval, dispositions on rejection |
| `SessionFinalize` | Finalize the stage after the user confirms — hands control back to the orchestrator, which verifies the artifact and advances the pipeline |
| `Read` | Read `product-design.md`, `technical-design.md`, project specs |
| `TodoWrite` | Surface the workflow as live tasks in the ticket's "Tasks (n/m)" sub-row (call once at the start; re-emit after each task to update statuses) |

## Flow

0. **Initialize task list** — call `TodoWrite` ONCE with the 6 items below; first item (`Examine context`) goes `in_progress`. Re-emit the full list after each task completes, marking the previous task `completed` and the next `in_progress`. The frontend reads the latest snapshot and renders it as the "Tasks (n/m)" sub-row in the phase tree.

   ```
   1. Examine context
   2. Build amendment plan
   3. Get plan approval
   4. Apply amendments file by file
   5. Cross-file self-review
   6. Finalize the stage
   ```

1. **Examine context** *(task #1)* — `Read` `product-design.md` + `technical-design.md` from `{{TR_DIR}}/tickets/{id}/`. Use `spec_search` to enumerate project specs related to what the technical design touches.

2. **Staleness branch.** If `spec_diff_stale: true` on the ticket, ask via `AskUserQuestion`: "Existing amendments are flagged stale (upstream design changed). Revise from scratch or evolve?" Branch:
   - *Evolve* — re-read the existing `.patch` log for prior intent; treat current on-disk specs as the in-progress baseline; continue refining.
   - *From scratch* — same on-disk state, but treat the existing amendments as the baseline and re-derive intent from `technical-design.md`.

3. **Build amendment plan** *(task #2)* — propose which spec files to amend, ordered general → specific (project goals/requirements → architecture → module designs → submodule designs → task specs). Each entry has `(file, rationale)`. Render via `thinkrail_visualize` (`type: summary-box`, `visId: amendment-plan`).

4. **Get plan approval** *(task #3)* — ask via `AskUserQuestion`: "Plan looks right?" with options "Approved", "Drop one: _____", "Add one I missed: _____", "Reorder: _____". Iterate until approved.

5. **Apply amendments file by file** *(task #4)* — for each spec file in plan order:

   a. `SetPreviewFile({ path })` so the file shows beside the chat. Optional: after the first accept on a file, call `LabelArtifact({ path, role: "spec", label: basename(path) })` so the chip shows the spec name.

   b. `Read` the file. Identify the sections that need amending against `technical-design.md`.

   c. **For each section/paragraph that needs to change:**
      - Call `Edit({ file_path, old_string, new_string })` per section/paragraph.
      - In `default` mode the user approves or denies the diff; if denied, the tool result carries the reason — revise and re-edit (don't re-issue the identical edit).
      - If validation warnings surface, note them and consider a follow-up fix.

   d. **Intra-file self-review.** After the last section of this file, `Read` the (now-amended) file. Check for: internal contradictions, broken cross-section references, missing context the new sections assume. Fix via more `Edit` calls. Otherwise note "self-review: clean" in the chat for transparency.

6. **Cross-file self-review** *(task #5)* — runtime check that surfaces findings in chat, no spec gets a "Self-review" section.
   1. Once all files in the plan are done, `Read` them together (plus `technical-design.md`). Check for:
      - Terms used differently across files.
      - Dangling cross-references between specs.
      - Contradictions between module designs and the architecture doc.
      - Concerns raised in TD that no spec file picked up.
   2. Report findings in chat as a short list (one bullet per issue). If clean, say "Cross-file self-review: clean."
   3. Ask via `AskUserQuestion`: "Cross-file self-review found N issues. How do you want to proceed?" Options:
      - *Address now* — fix each issue via `Edit` calls, then mark task #5 `completed` and continue.
      - *Accept and proceed* — mark task #5 `completed` without changes.
      - *Cancel transition* — keep ticket on amend-specs for further manual work.
   - Same rule for the intra-file checks in task #4: surface findings in chat, not in the spec file.

7. **Finalize the stage** *(task #6)*
   1. `ClearPreviewFile()`.
   2. **Confirm with the user** via `AskUserQuestion`: "All amendments done and self-reviewed. Finalize this stage and hand control back to the orchestrator?" If yes, call `SessionFinalize` with a one-line summary (this stage amends project specs and logs to `history.patch` — there is no single markdown artifact, so the artifacts list is empty):
      ```json
      {
        "summary": "Specs amended — N change(s) applied and logged to history.patch."
      }
      ```
   You do **not** advance the ticket yourself. Finalizing ends this stage — the board service commits the accumulated spec changes + the patch log — and resumes the orchestrator, which starts the next stage (`implementation-plan`).

## Red flags — STOP

- About to `git commit` during the step? STOP. The backend commits when this stage finalizes. A skill-side commit double-commits.
- Skipping the amendment-plan approval (jumping straight into edits)? STOP. The plan is where the user shapes scope; skipping it forfeits their veto on which files get touched.
- Edit was denied? Treat the returned reason as the next instruction; don't re-issue the identical edit.
- One `Edit`/`MultiEdit` covering multiple unrelated changes? Keep edits small and focused.
- Drafting amendments without first marking the current task `in_progress` via `TodoWrite`? STOP. The Tasks (n/m) sub-row stalls — users can't see what you're working on.
- About to call `TodoWrite` only once (at the start)? STOP. You must re-emit after each task to update statuses; the frontend reads the latest snapshot per session.

## Output format

After each applied `Edit`, the backend appends one hunk + metadata header to `{{TR_DIR}}/tickets/{id}/history.patch`:

```
# == amendment N =================================
# spec_id:    spec_abc12
# applied_as: original
# validation: ok                (or 'warnings' if frontmatter/links flagged)
# timestamp:  2026-05-22T15:30:00Z

--- a/{{TR_DIR}}/design_docs/MODULE_X.md
+++ b/{{TR_DIR}}/design_docs/MODULE_X.md
@@ -10,3 +10,3 @@
 ## Components
-Foo handles bar.
+Foo handles bar and baz.
```

The `.patch` file is a **session log** — never reverse-applied. Backward transitions out of `amend-specs` flip `spec_diff_stale=true` but leave the on-disk amendments intact for the next forward pass to evolve.
