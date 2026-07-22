---
id: task-unify-project-entry-flows
type: task-spec
status: done
title: Unify the three project-entry flows (Create / Open / Clone) + shared source of truth
parent: submodule-web-panels
---

# Unify the three project-entry flows (Create / Open / Clone) + shared source of truth

## Request

Three clearly-separated project actions everywhere (Welcome cards, PROJECTS rail, menu, dialog titles,
buttons), with identical labels/descriptions/order/icons, from one small shared source of truth. Each a
distinct **frontend-only mocked** dialog landing on the read-only `ProjectView`. Supersedes
[[task-create-project-from-scratch]] (create-only).

Order + copy: **Create new project** ("Create a new local folder and initialize a git repository."),
**Open local project** ("Open an existing project folder from this computer."), **Clone from GitHub**
("Clone a GitHub repository into a local folder."). Icons: `FolderPlus` / `FolderOpen` / `GitFork` (no
brand `Github` in this lucide).

## Change

- **`projectActions.tsx`** (new, source of truth): `PROJECT_ACTIONS` (id/label/description/icon/order),
  `MOCK_PARENTS`/`DEFAULT_PARENT`, `projectSlug`, and `createMockProject(name, path)` (the shared landing:
  append a `Project` + `selectProject`; no host call).
- **`ProjectDialogs.tsx`** (new, shell-mounted, store-driven by `projectDialog`): three distinct mocked
  dialogs — **Create** (name + live `~/code/<slug>` path preview + mocked Choose-folder + brief loading);
  **Open** (mocked folder cycler + non-git init prompt: "This folder is not a git repository." →
  Cancel / Initialize and open); **Clone** (repo URL → derived destination, with empty/valid/invalid/
  loading/exists/failure/success mock states + the specified validation copy). Buttons: Create project /
  Open project / Clone repository. Deleted the old single `CreateProjectDialog`.
- **store**: replaced `createProjectOpen`/`openCreateProject`/`closeCreateProject` with `projectDialog:
  "create"|"open"|"clone"|null` + `openProjectDialog(kind)`/`closeProjectDialog()`.
- **`AddProjectMenu`**: the two duplicate items (New project / Add existing repository → same flow) →
  the three `PROJECT_ACTIONS` items (`menu-project-{id}`) over Recents; `onAction(id)` opens the dialog.
- **`ProjectTree`**: menu `onAction → openProjectDialog`; folder-plus → `openProjectDialog("create")`;
  Recents keep the real re-open (`useOpenProject.openProject`).
- **`WelcomePanel`**: dropped `useOpenProject`/`AddProjectMenu`; renders the three `PROJECT_ACTIONS`
  cards (Create as CTA when no project) beside the unchanged Start building / Set up cards.

## Constraint reconciliation (user-approved)

All three flows are fully mocked (no `dialog.selectDirectory` / `project.open` / `inspect` / `init`).
Since `openFixtureProject` (~15 no-agent specs) relied on the real open to seed a **real** fixture repo,
the harness now seeds `projects.json` directly (`seedFixtureProject`, an existing test pattern — no wire
call); `projects.spec` (real picker/init) + the Welcome non-git test were removed (covered by
`create-project.spec`); `layout`/`welcome`/`ask-restart.live` updated to the new menu; `stagePlainFolder`
removed.

## Verification

- lint + typecheck + check:deps green; **full no-agent e2e: 60 passed**. `create-project.spec` covers all
  three flows (labels, path preview, non-git prompt, clone validation) + the shared ProjectView landing +
  no terminal at project level. Screenshots confirmed the Create / Open (init prompt) / Clone dialogs and
  the three Welcome cards.
