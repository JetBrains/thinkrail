---
id: task-diff-center-tab
type: task-spec
status: done
title: "Changes: open a file's diff as a center Monaco diff tab (no inline diff)"
parent: submodule-web-panels
---

# Changes: open a file's diff as a center Monaco diff tab

## Request (fully specified by the user)

- Remove the Changes panel's inline diff section entirely — the right panel only ever shows the file
  list (panel stays two regions: panel content + terminal, never three).
- Clicking a file in the Changes list opens its diff as a **center editor tab** (like spec files open
  as tabs), alongside the Chat tab. Tab title = the file name.
- Render with **Monaco's built-in diff editor**, side-by-side (old left, new right), standard features
  on: syntax highlighting, unchanged-region collapsing, next/previous change navigation, line numbers.
- Frontend-only — no backend / wire / contract changes; mocked data where needed; minimal; **own commit**.

## Design

- **Old-version content without a wire change** (replaces the "mock" allowance with real data,
  unconfirmed-but-strictly-better inference): the pane fetches `git.diff {workspaceId, path}` (a
  unified patch; the host already returns full-file patches for untracked files via `--no-index`) +
  `fs.readFile` (current content; a failed read = deleted file = ""), and **reverse-applies the patch**
  to the current content to reconstruct the base version (`panels/unifiedDiff.ts`, unit-tested).
  Added/untracked ⇒ reconstructs to ""; deleted ⇒ current "" reconstructs to the full old file.
- **Store:** new `DiffTab` in the `EditorTab` union — `{ kind: "diff", id: "diff:<ws>:<path>",
  workspaceId, path, name }` (lean: the pane owns fetching; no content in the store). Existing
  `openTab`/`closeTab`/tab-strip logic is kind-agnostic.
- **Open flow:** `openDiffInTab(workspaceId, path)` beside `openFileInTab` in `panels/openFile.ts` —
  focus-if-open, else open; the `diff:` id prefix keeps it distinct from the same path's file tab.
- **`panels/DiffPane.tsx`** (new, lazy from `CenterTabs` like `FilePane`'s Monaco): slim header
  (path + prev/next change buttons via Monaco's `goToDiff`) over `@monaco-editor/react`'s
  `DiffEditor` — `renderSideBySide`, `hideUnchangedRegions`, `readOnly`, line numbers on; language
  inferred from `diff-original|modified/<ws>/<path>` model paths (extension-based, collision-free with
  file-tab models); reuses the shared `thinkrail` Monaco theme + re-theme-on-swap observer (exported
  from `MonacoEditor.tsx` instead of duplicated). **Live:** refetches on the workspace fs tick
  (skips a single unrelated batch by path, like `FilePane`).
- **`ChangesPanel`:** selection/inline-diff state and the `max-h-1/3` split are removed — the list
  fills the panel; a row click (and the chat turn-divider **deep-link**, which now marks its request
  handled in a ref so a later status refresh doesn't re-steal focus) calls `openDiffInTab`.
- **Deleted:** `panels/DiffViewer.tsx` (shiki unified-diff renderer — now unreferenced).
- **e2e:** `changes.spec` + `live-refresh.spec` (no-agent) and `turn-divider.live.spec` (@agent)
  re-pin to the new behavior: click ⇒ a `data-kind="diff"` center tab whose `diff-pane` carries the
  changed text and follows live edits.
- **Specs updated:** `panels/SPEC.md` (ChangesPanel/DiffPane/CenterTabs prose), `store/SPEC.md`
  (`EditorTab` union).

## Explicitly out of scope (minimal)

Gutter revert actions (would need writes), whole-worktree diff tab, diff tabs surviving a file's
rename, editing in the diff view.
