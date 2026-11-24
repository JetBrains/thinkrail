---
id: submodule-server-github
type: submodule-design
status: active
title: github — local gh auth status
parent: module-server
depends-on: [module-contracts]
tags: [public-surface-checked]
---

## Responsibility

Read-only local GitHub CLI (`gh`) auth status for the New-Workspace dialog's "Connected" pill + Refresh
(and the Settings "Local GitHub" block). Shell-out only, server-side, on the host's resolved login PATH.

## Boundary

- **Owns:** `githubAuthStatus()` → `Promise<GithubAuthStatus>`, `githubRefresh()` (the same check), and
  `ghSetupProblem()` → `Promise<GhSetupProblem | null>` — the *named* reason the direct gh path is
  unavailable. Both read one probe, `gh auth status --hostname github.com --json hosts`, with one of four
  verdicts (see Get right): signed in → `{ connected: true, login?, scopes? }` / `null`; signed out →
  `{ connected: false }` / `unauthenticated`; unverified → `{ connected: false, unverified: true }` /
  `null`; gh can't launch → `{ connected: false }` / `missing`. `THINKRAIL_GH_OFFLINE=1` forces
  `{ connected: false }` / `null` without shelling (e2e drives the offline path). The probe runs under
  `subprocess`' `runBounded` at an 8s budget (`GH_PROBE_TIMEOUT_MS`): `gh auth status` does a network
  round-trip, and the host is one event loop — a `spawnSync` here would freeze every session for the
  probe's duration, which is exactly the failure `runBounded` exists to rule out (see
  `subprocess/SPEC.md`). `pr` consumes `ghSetupProblem` (after a failed gh flow only) so the client can
  show setup guidance instead of silently degrading to the compare page.
- **Public surface (barrel):** `githubAuthStatus`, `githubRefresh`, `ghSetupProblem`.
- **Allowed deps:** `contracts` (`GithubAuthStatus`); `subprocess` (`runBounded`, the bounded child the
  probe spawns under). No `git`/`projects` reach — it's a pure `gh` probe.
- **Forbidden:** `host`; sibling features; being bundled into the browser (`gh` is shelled, never bundled).

## Get right

- **`missing` means the probe could not launch `gh`; there is no `Bun.which("gh")` pre-check.** A bare
  `Bun.which` reads the PATH from process start (the trap in `editors/SPEC.md`), and a Dock or Finder
  launch gets the login PATH only later, from `resolveShellEnv()`. So the pre-check said `missing` for a
  `gh` that the callers could run (#1283). The probe resolves `gh` on the same live PATH as they do.
- **Report signed out only when gh says so; every other answer is `unverified`.** Signed out is no
  github.com account, `refresh_expired` (a refused token refresh) or an `error` starting `HTTP 401:`.
  A timeout (gh's or our 8s), a network, proxy or 5xx `error` and output that isn't gh's JSON (a mise or
  asdf shim with no version set) are `unverified`. So is an invalid `GH_TOKEN`: gh words its 401
  differently, and `gh auth login` would not fix it. Plain `gh auth status` exits 1 both when gh can't
  reach GitHub (gh 2.83.1 says "The token in keyring is invalid") and for a stale token on another host;
  `--json` exits 0 and names the cause. Only github.com is probed: `pr` opens PRs only there.
- **gh runs with `CLICOLOR_FORCE=0` and without `GH_FORCE_TTY`.** With `CLICOLOR_FORCE=1` or
  `GH_FORCE_TTY` in the host env, gh colors its `--json` output on a pipe, and `NO_COLOR` does not stop
  `CLICOLOR_FORCE`. Colored JSON doesn't parse, so a signed-in gh would read as `unverified`.
- **When the JSON call exits non-zero, the probe runs the text form once**, unless it timed out (a second
  8s wait would tell nothing new): gh before 2.81 has no `--json`, and Ubuntu 24.04 ships gh 2.45. gh
  2.40 to 2.53 exit 0 even when the check failed, so in the text form exit 0 is signed in only when the
  first account line (gh lists the active account first) says "Logged in to". "not logged into any" or
  "not found among authenticated GitHub hosts" is signed out, and the rest is unverified, so on old gh a
  rejected token gets no sign-in hint. gh 2.54 to 2.80 exit 1 when any github.com account fails, so there
  a signed-in user who keeps a second, expired account reads as unverified: accepted, because it is rare
  and Open PR still falls back to the compare page.
- **Not `gh auth token`.** It reads the keyring entry directly (on macOS it exited 0 with an empty
  `GH_CONFIG_DIR`), so it can disagree with `gh auth status`, and it prints the secret.
