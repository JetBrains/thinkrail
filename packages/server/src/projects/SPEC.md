---
id: submodule-server-projects
type: submodule-design
status: active
title: projects — git repos as projects
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Keep one stable registry of known git repositories, expose its open and recent views, and open/close a
project without breaking its workspace identity. For a folder that is not a repo yet, classify it and
bootstrap it into one so it can be opened.

## Boundary

- **Owns:** validate a path is a repo (`git rev-parse --show-toplevel`), dedupe by root, assign a stable
  unique readable `slug`; `getProjects` (all known records, with slug backfill), `listProjects` (open
  records only, by `lastOpened`), and `listRecentProjects` (open + closed, by `lastOpened`). A persisted
  optional **`Project.closed: true`** is the entire membership state: absence means open, so existing
  records migrate as open. **`openProject`** finds a known root even when closed, clears `closed`, bumps
  `lastOpened`, preserves its id, persists, and publishes the full snapshot; **`closeProject`** marks that
  same record closed and publishes it without deleting the project, repository, workspace records, or
  live runtimes. **One cwd, one ThinkRail identity:** `openProject` rejects a root already held as some
  workspace's `worktreePath` — pi keys chat transcripts by *directory*, so a second identity on an owned
  folder would serve that workspace's chats as its own and have them purged when either side is archived.
  Compared **canonically** (a managed worktree's stored path is composed, `--show-toplevel` answers
  symlink-resolved) and only **after** the reopen above, whose own Default workspace legitimately holds the
  project folder. The workspace-side half of the same door is `openExistingWorktree`
  ([[submodule-server-workspaces]]); reading the workspace records for it stays within the `persistence`
  dep — this module still never imports its sibling. `setProjectPublisher` is the host-injected push seam; this module never imports `host`.
  **Create-from-scratch (agent-led new project).** `createDraftProject()` bootstraps a brand-new
  project the user has no repo for yet: it mkdirs a fresh managed dir under the **created-projects root**
  `<dataDir>/projects/<uuid>` (uuid → **never a path collision, never an overwrite**), `initProject`s it,
  then marks the record **`draft: true`** with a provisional display **`name` ("Project draft")** and a
  slug from it. `draft` is a lifecycle flag (mirroring `closed`), **not** a project type — a draft is a
  real, server-owned project that simply hasn't been named/finalized yet; it hydrates and lists like any
  open project. The setup chat runs in the draft's real Default workspace ([[submodule-server-workspaces]]),
  and the agent-led interview asks the name **last**, writes `goal-and-requirements.md`, then finalizes.
  `finalizeProjectByPath(cwd, name)` / `finalizeProject(id, name)` apply the user-confirmed display
  **`name`** (decoupled from `path` — a managed dir's basename is a uuid), re-uniquify the `slug`, clear
  `draft`, **commit `goal-and-requirements.md`** if present (`git add` + commit with the same fallback
  identity as `initProject`; a no-op/failed commit is ignored — finalize never fails on it) so a later
  isolated worktree inherits the brief, persist, and publish the full snapshot; both **throw** on a
  non-draft (finalize is one-shot). The
  `cwd` variant is the seam the host-owned `finalize_project` agent tool keys on (the Default workspace's
  cwd is the project folder). `discardDraftProject(id)` is the abandon/recovery path (section 9): it
  **refuses a non-draft**, removes the project record **and its workspace records** (via `persistence` —
  the same sibling-free access the open-guard uses), `rmSync`s the managed dir **only when it resolves
  under the created-projects root** (a hand-edited record pointing at a user dir is never removed), and
  **publishes a `project.removed` push** via the injected `setProjectRemovedPublisher` seam so every
  client drops the record (the removed counterpart of `setProjectPublisher`). A failed
  `createDraftProject` rolls back its dir so nothing is left registered.
  It also owns **`inspectProjectPath`** (classify a path — `repo` / `initable` / `missing` /
  `notDirectory` — so the UI picks between opening, an init offer, or an error) and **`initProject`**
  (bootstrap a plain directory: `git init` + `git add -A` + an **allow-empty** initial commit — committing
  the folder's contents, or an empty commit when it is empty, so the repo gets a HEAD and `git worktree
  add` works; an already-a-repo path short-circuits to `openProject`; a missing / non-dir path throws).
  The commit supplies a **fallback `user.name`/`user.email` only for a field git has none configured for**,
  so a real global identity is never overridden. ("Does the project have specs?" is **not** computed here
  — `host` answers the lazy `project.hasSpecs` query via `spec.projectHasSpecs`, keeping this module free
  of any spec dependency.)
- **Public surface (barrel):** `openProject`, `listProjects`, `listRecentProjects`, `closeProject`,
  `getProjects`, `setProjectPublisher`, `setProjectRemovedPublisher`, `inspectProjectPath`,
  `initProject`, `createDraftProject`, `finalizeProject`, `finalizeProjectByPath`, `discardDraftProject`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, which now owns the
  environment its children spawn under — this module passes none); `contracts` (`Project`, `ProjectPathStatus`); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
