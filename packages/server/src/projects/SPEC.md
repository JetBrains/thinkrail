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
  live runtimes. `setProjectPublisher` is the host-injected push seam; this module never imports `host`.
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
  `getProjects`, `setProjectPublisher`, `inspectProjectPath`, `initProject`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, bound to live `env` for
  config overrides); `contracts` (`Project`, `ProjectPathStatus`); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
