---
id: task-project-readonly-view
type: task-spec
status: done
title: Read-only project view with an Edit dropdown (worktree or inline)
parent: submodule-web-panels
---

# Read-only project view with an Edit dropdown

## Request

Selecting a project opens the **project (its main branch) read-only** in the center — not a workspace.
Header: avatar + name + a "Read-only · main" lock badge + an **Edit** dropdown. Body: the project's files
in **read-only Monaco** (mock file tree + contents). Typing in read-only shows a **soft-edit hint**
("Editing the main branch is off. Work in a workspace instead." + a "New worktree" action). The Edit
dropdown has exactly: **Edit in new worktree** (Recommended → the Create-workspace modal, pre-scoped) and
**Edit inline here** (turns read-only off for the session).

## Confirmed decisions

- **Replace project-home entirely** (user-confirmed): selecting a project → read-only ProjectView; the
  card-based project-home (Set up / Start building) is removed. Welcome stays only for the **no-project**
  empty state. "Start building" is subsumed by "Edit in new worktree".
- **Single centered read-only browser** (user-confirmed): left panel + one center screen (its own header +
  mock file list + read-only Monaco). **No right rail / no terminals** (those stay worktree-scoped).

## Design

- **Routing (`store` + `Shell`):** revert `selectProject` to `{ selectedProjectId, activeWorkspaceId:
  null }` (no skip-welcome auto-enter) — so a project click shows the read-only view, and `activateWorkspace`
  (workspace row / create) is the only path into the 3-col workspace view. Remove the now-dead
  `lastActiveWorkspaceByProject` (state + `activateWorkspace` write). `Shell` center panel branches:
  `hasActiveWorkspace` → `MainHeader`+`CenterTabs` (+ right rail); else `selectedProjectId` → **`ProjectView`**
  (full center, its own header, no `MainHeader`); else `MainHeader`+`WelcomePanel`.
- **`panels/ProjectView.tsx`** (new, mock-backed, clearly labelled MOCK): header (`h-[48px]`) = avatar
  (shared `projectAvatarColor`) + name + **"Read-only · main"** `Lock` badge + right-aligned **Edit**
  `DropdownMenu` (reused button/dropdown styles); body = a compact mock file list + read-only
  `MonacoEditor`. Session state: `readOnly` (useState, default true; per project via `key`), `activeFile`,
  a transient soft-edit `hint`. Edit items: **Edit in new worktree** (Recommended) → `NewWorkspaceDialog`
  (`projectId`, `onCreated` → `activateWorkspace`); **Edit inline here** → `setReadOnly(false)`.
- **`MonacoEditor`**: add optional `readOnly` (default `true`, preserves existing viewer usages) +
  `onReadOnlyEdit` — wired via Monaco's `onDidAttemptReadonlyEdit`, so a keystroke in read-only fires the
  soft-edit hint (message + "New worktree" button → opens the dialog) instead of being silently swallowed.
- **`projectAvatar.ts`** (new): extract `projectAvatarColor` (from `ProjectTree`) so the row + the view
  share one deterministic color helper.
- **Mock:** a small hardcoded file map (README/src/package.json) in `ProjectView`, labelled "(mock)".

## Ripple (updated with the change, not worked around)

`selectProject` no longer auto-enters, and "project selected + no workspace" now renders `ProjectView`
(was project-home Welcome). Update: `appStore.test.ts` (drop the skip-welcome auto-enter + sibling-reenter
+ `lastActiveWorkspaceByProject` cases → new select-only behavior), `welcome.spec` (the project-home-card
tests → assert `ProjectView`; the "clicking a project re-enters a workspace" test → opens `ProjectView`),
`workspace-lifecycle.spec` (removing the active workspace → `ProjectView`, not Welcome). Workspace creation
(left-panel `add-workspace`) is unaffected, so file/editor/terminal/workspace specs keep working. Add a
no-agent `project-view.spec` (mock data needs no agent): project-view renders read-only, Edit dropdown has
the two options, "Edit in new worktree" opens the Create-workspace dialog, "Edit inline here" clears
read-only.

## Constraints honored

Frontend-only, mock file data (no wire); reuse Monaco/Create-workspace modal/dropdown/tooltip styles; no
new tokens/text styles; terminals + running-state + unrelated panels untouched; view state is client-only.
