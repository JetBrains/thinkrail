---
id: submodule-server-demo
type: submodule-design
status: active
title: demo — bundled demo project
parent: module-server
depends-on: [module-contracts, submodule-server-projects]
tags: [v1]
---

## Responsibility

Materialize the bundled **To Do App** demo as a real, user-owned git repository so first-run onboarding
needs no repo of the user's own. The demo is a **normal Project** the moment it exists — it participates
in the ordinary Project → Workspace → git-worktree flow with no separate/fake project model — so this
module only owns the *materialization* (copy template + `git init`) and *file cleanup*; opening,
workspaces, sessions, and worktrees are the existing modules' jobs, unchanged.

**Lazy, never eager.** The copy happens only when the user explicitly starts the demo (the `demo.ensure`
wire door), never at host startup.

**Ships its own spec.** The bundled template carries a small `SPEC.md` (a `goal-and-requirements` node
describing the To Do App), so the demo is a *specced* project from first open: `project.hasSpecs` is true,
the Specs side-tool has content, and the Welcome fork leads with "Start building" rather than the
spec-first "Set up project" — the natural path for the onboarding tour.

**Reset is the onboarding replay door.** `demo.reset` (host-orchestrated, below) archives the demo's
workspaces, drops the project record, and deletes the user-local copy, returning the app to the empty
first-run state — the frontend "Reset demo" control that lets a user replay the onboarding tour is built
on it (see the web onboarding SPEC).

## Boundary

- **Owns:**
  - `demoProjectPath()` — the fixed user-local location `dataDir()/demo/to-do-app` (honours
    `THINKRAIL_DATA_DIR`). Deliberately **not** under `dataDir()/worktrees` — that tree is reserved for
    managed worktree dirs keyed by project slug ([[submodule-server-workspaces]]).
  - `ensureDemoProject()` — idempotent: when the target is absent, copy the bundled template into it
    (never mutating the bundled source), then hand off to `initProject` (git init + initial commit, or a
    short-circuit `openProject` when the repo already exists) and set the display **`name`** to
    "To Do App" via `projects`' `setProjectName` (the folder + `slug` stay `to-do-app`; the existing
    display-name field, not a new naming concept). Returns the `Project`. A second call re-opens the
    existing record rather than re-initialising.
  - `removeDemoFiles()` — `rm -rf` the user-local copy. The *domain* half of a reset (archiving the
    demo's workspaces + dropping the project record via `deleteProject`) is orchestrated by `host`, which
    can reach the per-workspace teardown seams this module must not (terminals, spec index, reviews,
    watch, layout).
  - Template source resolution: `THINKRAIL_DEMO_DIR` (the staged root the binary sets — see the CLI
    SPEC) when present, else the in-repo dev path `packages/server/assets/demo`. Both point at the parent
    that contains `to-do-app/`.
- **Public surface (barrel):** `demoProjectPath`, `ensureDemoProject`, `removeDemoFiles`, `DEMO_APP_DIR`.
- **Allowed deps:** `projects` (`initProject`); `persistence` (`dataDir`); `contracts` (`Project`);
  Node/Bun.
- **Forbidden:** `host`; sibling features other than `projects` (no `workspaces`/`agent`/`terminal`
  reach — reset orchestration lives in `host`); mutating the bundled template under `packages/server/assets`.
