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

Open a git repository as a project (list/close projects), and — for a folder that isn't a repo yet —
classify it and bootstrap it into one so it can be opened.

## Boundary

- **Owns:** validate a path is a repo (`git rev-parse --show-toplevel`), dedupe by root, assign a stable
  unique readable `slug`; `getProjects` (load + slug-backfill + save), `listProjects` (by `lastOpened`),
  `openProject`, `closeProject`; **`inspectProjectPath`** (classify a path — `repo` / `initable` /
  `missing` / `notDirectory` — so the UI picks between opening, an init offer, or an error) and
  **`initProject`** (bootstrap a plain directory: `git init` + `git add -A` + an **allow-empty** initial
  commit — committing the folder's contents, or an empty commit when it's empty, so the repo gets a HEAD
  and `git worktree add` works; an already-a-repo path short-circuits to `openProject`; a missing / non-dir
  path throws). The commit supplies a **fallback `user.name`/`user.email` only for a field git has none
  configured for**, so a real global identity is never overridden.
- **Public surface (barrel):** `openProject`, `listProjects`, `closeProject`, `getProjects`,
  `inspectProjectPath`, `initProject`.
- **Allowed deps:** `persistence`; the `git` sub-module (shared `git()` runner, bound to live `env` for
  config overrides); `contracts` (`Project`, `ProjectPathStatus`); Node/Bun.
- **Forbidden:** `host`; sibling features other than `git` (`workspaces` depends on `projects`, never the
  reverse).
