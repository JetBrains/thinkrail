---
id: task-create-project-from-scratch
type: task-spec
status: deprecated
title: "Create-project-from-scratch flow: two entry points + mock create dialog"
parent: submodule-web-panels
---

# Create-project-from-scratch flow: two entry points + mock create dialog

## Request

A "Create project from scratch" flow: (1) a new-folder button beside the rail's open-project button, and
(2) a "Create project from scratch" card beside Welcome's "Open project" card — both opening a create
dialog (project name + helper + read-only parent path, no templates, "Create project"). On create,
init a new empty local repo (mock) → it appears in PROJECTS → land on the empty project view. Mock the
host-side creation; reuse existing modal/card/input/button styles + icons.

## Change

- **`store`:** `createProjectOpen` + `openCreateProject()` / `closeCreateProject()` (mirrors
  `settingsOpen`), so both entry points open one shell-mounted dialog.
- **`CreateProjectDialog`** (new, shell-mounted): styled like `NewWorkspaceDialog` — DialogTitle "Create
  project", a **project name** input with helper "Creates folder and repo <name>", a **read-only parent
  folder** chip (mock default `~/code`), and a **Create project** button (Enter also submits; disabled
  while empty). **MOCK create**: builds a `Project` (uuid id, `~/code/<name>` path, slugified `slug`) →
  `setProjects([...projects, p])` → `selectProject(p.id)` → close, landing on the empty read-only
  `ProjectView` (which prompts the first worktree via its Edit dropdown). No host call.
- **`ProjectTree`:** a `FolderPlus` button (`create-project-menu`) beside the `AddProjectMenu` folder-open
  trigger → `openCreateProject`.
- **`WelcomePanel`:** a `createProjectCard()` (`FolderPlus`, "Create project from scratch" / "Start a
  brand-new local git repo.") rendered beside "Open project" in every state → `openCreateProject`.

## Follow-up (out of scope)

Real creation is a host `project.create` + `git init` (a wire/contract change). Everything here is mock
(clearly labelled); no templates section (a later addition).

## Verification

- lint + typecheck + check:deps green.
- `e2e/create-project.spec.ts` (no-agent): the Welcome card opens the dialog, shows the `~/code` parent +
  the live "Creates folder and repo <name>" helper, and creating lands a `my-new-app` project row +
  `ProjectView`; the rail's new-folder button opens the dialog (Create disabled while empty). Screenshots
  confirmed the dialog, the two rail buttons, and the Welcome card.
