---
id: task-project-select-skip-welcome
type: task-spec
status: done
title: Selecting a project with workspaces skips Welcome, activates a workspace
parent: submodule-web-panels
---

# Selecting a project with workspaces skips Welcome, activates a workspace

## Request

When a project is selected in the sidebar and it already has workspaces, skip the Welcome screen and
go directly to the workspace view. The Welcome screen (Set up project / Start building / Open project
cards) should only show when the project has no workspaces yet.

## Current recorded behavior (what this changes)

- `panels/SPEC.md` documents the opposite: selecting a project row **deselects any active workspace**
  → the shell returns to that project's Welcome — a deliberate "project home" gesture.
- `store.selectProject(id)` = `{ selectedProjectId: id, activeWorkspaceId: null }`; the shell branches
  on `activeWorkspaceId == null` → WelcomePanel.
- Workspaces are loaded **lazily** per project (`workspace.list` on select/expand), so at click time
  the store may not yet know whether the project has workspaces.

## Decisions (user-confirmed)

1. **Which workspace opens:** the **last-active workspace for that project** (session-only memory in
   the store), falling back to the **newest** workspace (last element of the list — persistence is
   append-ordered) when there's no memory yet or the remembered one is gone.
2. **Removal follows the same rule:** removing the active workspace activates a sibling (last-active
   → newest) when any remain; Welcome only when the project has no workspaces left.
3. **No project-home gesture survives:** Welcome is strictly the empty-project surface. The
   "project home" gesture recorded in `panels/SPEC.md` is retired.
4. **Frontend-only, minimal.** No backend/wire changes — `workspace.list` already exists and is what
   the sidebar uses today; no mocking needed.

## Design

- **Store** (`appStore.ts`):
  - New session-only field `lastActiveWorkspaceByProject: Record<string, string>`;
    `activateWorkspace` records `projectId → workspace.id`.
  - `selectProject(projectId)` changes semantics: from the **cached** `workspaces[projectId]`, pick
    last-active-if-present → else newest (last element) → activate it; if the cached list is empty or
    absent, fall back to `{ selectedProjectId, activeWorkspaceId: null }` (Welcome). Stays a pure,
    synchronous action over cached data — the one decision point.
  - `applyWorkspaceRemoved` keeps calling `selectProject(projectId)` after dropping the row; the new
    semantics make it pick a sibling or Welcome automatically. Stale `lastActiveWorkspaceByProject`
    entries need no cleanup — the "still in the list" check makes them inert.
- **Async gap** (first select after connect: `server.welcome` carries projects, not workspaces): the
  sidebar's select handler **awaits `workspace.list` → `setWorkspaces` before calling
  `selectProject`**, so the decision always runs on fresh data and Welcome never flashes for a
  project that turns out to have workspaces. This orchestration is one shared panels-level helper
  (`selectProjectWithWorkspaces(projectId)` in `panels/useOpenProject.tsx` or a sibling), used by
  `ProjectTree` row clicks **and** the open-project adopt callbacks (`ProjectTree`, `WelcomePanel`) —
  no duplicated load-then-select at call sites.
- **Tests:** existing unit + e2e tests stay green (they cover the empty-list and only-workspace
  cases). Add unit tests for the new `selectProject` pick order (last-active → newest → Welcome) and
  removal-jumps-to-sibling.
- **Spec updates on landing:** `panels/SPEC.md` (retire the project-home gesture; document the
  helper), `store/SPEC.md` (`selectProject` semantics + new field). Then retire this task-spec.

## Approaches considered

- **Decide in the sidebar component** (ProjectTree picks and calls `activateWorkspace` itself):
  rejected — duplicates the pick across ProjectTree / WelcomePanel / removal path; store is the
  single decision point per repo rules.
- **Select immediately, jump when the list resolves:** rejected — flashes Welcome for a project that
  has workspaces; the await is milliseconds on a local host.
- **Persist last-active per project on the host:** rejected — user scoped this to frontend-only;
  session memory + newest-fallback is enough.
