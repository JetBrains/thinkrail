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
- **Public surface:** `findOpenBranchReview(cwd, branch)`; plus the read primitives the `pr` action module reuses — `providerFromRemoteUrl`, `reviewNumber`, and `runProviderCommand` (the bounded prompt-disabled CLI runner).
- **Allowed deps:** `contracts` for the result type; the server `git` barrel for local remote inspection and for `nonInteractiveGitEnv()`, the one definition of the environment a subprocess runs under — `process.env` plus `GIT_TERMINAL_PROMPT=0` (this module layers its own `GH_PROMPT_DISABLED`/`GLAB_PROMPT_DISABLED` on top); the `subprocess` barrel, which runs the lookup under this module's `LOOKUP_TIMEOUT_MS`.
- **Forbidden:** `host`, `workspaces`, browser code, persistence, or any PR/review action beyond this read (actions live in `pr`).
- Missing CLI/authentication, unsupported remotes, timeouts, malformed output, and no open review all degrade to `null`.
- **The bound has to be the *call's*, not the child's.** Killing `gh`/`glab` and then awaiting its stdout to
  EOF never returns when a grandchild inherited that pipe, and `review.get` awaits this lookup — so the
  degrade-to-`null` promised above was reachable only through the client's own causeless request timeout.
  `subprocess`' `runBounded` is what makes `LOOKUP_TIMEOUT_MS` real; this module must never grow a second
  spawn of its own.
