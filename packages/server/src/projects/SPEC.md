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

Open a git repository as a project, and list/close projects.

## Boundary

- **Owns:** validate a path is a repo (`git rev-parse --show-toplevel`), dedupe by root, assign a stable
  unique readable `slug`; `getProjects` (load + slug-backfill + save), `listProjects` (by `lastOpened`),
  `openProject`, `closeProject`.
- **Public surface (barrel):** `openProject`, `listProjects`, `closeProject`, `getProjects`.
- **Allowed deps:** `persistence`; `contracts` (`Project`); Node/Bun (git invocation).
- **Forbidden:** `host`; sibling features (`workspaces` depends on `projects`, never the reverse).
