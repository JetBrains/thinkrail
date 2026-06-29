---
id: submodule-server-github
type: submodule-design
status: active
title: github — local gh auth status
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Read-only local GitHub CLI (`gh`) auth status for the New-Workspace dialog's "Connected" pill + Refresh
(and the Settings "Local GitHub" block). Shell-out only, server-side, on the host's resolved login PATH.

## Boundary

- **Owns:** `githubAuthStatus()` → `{ connected, login?, scopes? }` by shelling `gh auth status` (parsing
  its report for the account + token scopes); `githubRefresh()` (re-shells the same check). Degrades
  gracefully — a missing / un-authed `gh` returns `{ connected: false }` so the dialog works fully offline.
  `THINKRAIL_PI_GH_OFFLINE=1` forces the disconnected result without shelling (e2e drives the offline path).
- **Public surface (barrel):** `githubAuthStatus`, `githubRefresh`.
- **Allowed deps:** `contracts` (`GithubAuthStatus`); Bun (spawn). No `git`/`projects` reach — it's a pure
  `gh` probe.
- **Forbidden:** `host`; sibling features; being bundled into the browser (`gh` is shelled, never bundled).
