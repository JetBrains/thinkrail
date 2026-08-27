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
  `THINKRAIL_GH_OFFLINE=1` forces the disconnected result without shelling (e2e drives the offline path).
  Also `ghSetupProblem()` → `Promise<GhSetupProblem | null>` — the *named* reason the direct gh path is
  unavailable (`missing` when `Bun.which("gh")` finds no binary, `unauthenticated` when a **non-blocking**
  `gh auth status` probe exits non-zero, `null` when gh is usable or the offline seam is on). The probe is
  async with an 8s TERM + 2s KILL escalation: `gh auth status` does a network round-trip, and the host is
  one event loop — a spawnSync here would freeze every session for the probe's duration. A probe that
  TIMED OUT reports `null` (a transient network stall is not "signed out" — the silent compare fallback,
  never the sign-in dialog). `pr` consumes it (after a failed gh
  flow only) so the client can show setup guidance instead of silently degrading to the compare page.
- **Public surface (barrel):** `githubAuthStatus`, `githubRefresh`, `ghSetupProblem`.
- **Allowed deps:** `contracts` (`GithubAuthStatus`); Bun (spawn). No `git`/`projects` reach — it's a pure
  `gh` probe.
- **Forbidden:** `host`; sibling features; being bundled into the browser (`gh` is shelled, never bundled).
