---
id: submodule-server-terminal
type: submodule-design
status: active
title: terminal — workspace PTYs
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Workspace-scoped `bun-pty` terminals, each rooted in the worktree cwd; their output streams to clients.

## Boundary

- **Owns:** PTYs keyed by id (each tagged with its `workspaceId`); output pushed on the `terminal.data`
  channel via an injected publisher; `createTerminal`/`writeTerminal`/`resizeTerminal`/`closeTerminal`,
  `closeWorkspaceTerminals(workspaceId)` (kill the workspace's PTYs when it's **archived**, so no shell
  orphans on a now-deleted worktree dir — the host calls it before removing the worktree),
  `closeAllTerminals()` on shutdown, `setTerminalPublisher`.
- **Public surface (barrel):** the five terminal operations + `closeWorkspaceTerminals` + `closeAllTerminals`
  + `setTerminalPublisher`.
- **Allowed deps:** `persistence` (worktree cwd lookup); `contracts` (`WS_CHANNELS`); `bun-pty`; `process.env`.
- **Forbidden:** `host`; sibling features.
