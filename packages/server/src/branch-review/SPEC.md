---
id: submodule-server-branch-review
type: submodule-design
status: active
title: branch-review — open PR/MR metadata
parent: module-server
depends-on: [module-contracts]
implements: [task-branch-pr-awareness]
tags: [github, gitlab, pull-request]
---

## Responsibility

Best-effort lookup of the open code review associated with a workspace branch: GitHub.com PR via the local `gh` CLI or GitLab.com MR via `glab`.

## Boundary

- **Owns:** remote-host detection and bounded, asynchronous CLI lookup returning an `OpenBranchReview` or `null`.
- **Public surface:** `findOpenBranchReview(cwd, branch)`.
- **Allowed deps:** `contracts` for the result type; the server `git` barrel for local remote inspection; Bun/Node process APIs.
- **Forbidden:** `host`, `workspaces`, browser code, persistence, or any PR/review action beyond this read.
- Missing CLI/authentication, unsupported remotes, timeouts, malformed output, and no open review all degrade to `null`.
