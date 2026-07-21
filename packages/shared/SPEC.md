---
id: module-shared
type: module-design
status: active
title: Shared server-side utilities
parent: architecture
depends-on: []
tags: [v1, host]
---

## Responsibility

Cross-cutting runtime utilities used by the engine host. Server-side only — never bundled into `apps/web`.
Exposed through explicit subpath exports, not a barrel.

## Boundary

- **Owns:** host-side runtime helpers that are neither engine- nor transport-specific.
- **Public surface:** `@thinkrail/shared/shellEnv` → `resolveShellEnv()`, `pathLooksComplete()`;
  `@thinkrail/shared/freePort` → `findFreePort()`, `isPortFree()`;
  `@thinkrail/shared/paths` → the worktree-relative path conventions (`WORKSPACE_INTERNAL_DIR`,
  `WORKSPACE_CONTEXT_DIR`, `WORKSPACE_TODOS_DIR`);
  `@thinkrail/shared/jbcentral` → the full jbcentral protocol: `isJbcentralProxyUrl()` (read) +
  `isJbcentralInstalled()` / `wireJbcentral()` / `unwireJbcentral()` / `launchJbcentralLogin()` (write) + the
  pure transforms/consts they compose (`buildProxyUrls`, `apply`/`removeJbcentralOverrides`,
  `resolveProxyPort`, `jbcentralInstall` (the single source of truth for the per-OS install one-liner),
  `probeJbcentralSecret`, …).
- **Allowed deps:** Bun/Node runtime (`@types/bun`); `contracts` **types** (`JbcentralInstall`, the wire shape
  `jbcentralInstall` returns — kept in the wire so the server can carry it to the card verbatim).
- **Forbidden:** importing `server` / `web` / any `pi` package; being imported by `web` (it carries
  Bun/Node code that must not reach the browser bundle).

## Contents

- **/shellEnv** — `resolveShellEnv()`: ensure `process.env.PATH` is the user's full login PATH so the
  in-process agent's bash/tools find `git`/`node`/etc. when the host is launched from Finder/Dock.
- **/freePort** — `findFreePort(preferred, host?)`: the first free port at or above `preferred`, so a
  host can pick an open port instead of colliding with one already running. `isPortFree(port, host?)`:
  the underlying single-port check.
- **/paths** — the worktree-relative path conventions ThinkRail owns, named once so current and future
  consumers agree (today: `workspaces` *creates* the scratch dir and git *ignores* it):
  `WORKSPACE_INTERNAL_DIR` (`.thinkrail` — the repo-local host-managed dir, today holding the ephemeral
  scratch, the intended home for future host files like a cached spec index; **not** hidden from the file
  tree), `WORKSPACE_CONTEXT_DIR` (its `context/` scratch dir for temp docs), and `WORKSPACE_TODOS_DIR`
  (`context/todos/` — the chat TODO plans, one JSON per session, so they're ephemeral with the rest of
  the scratch). The pi-free `pi-todos/core` can't import this package (it stays vanilla-`pi`-installable),
  so it keeps a local mirror of the todos path; this module is the host-side source of truth. Distinct
  from the *home* state dir `~/.thinkrail` (server `persistence`). (The `.gitignore` *body* the host seeds
  into the scratch dir — a lone `*` — is a one-off inlined at that call site, not a path, so it lives
  there, not here.)
- **/jbcentral** — the **single home for the JetBrains Central CLI proxy protocol**, both read and write, so
  they can't silently diverge (a co-located drift test asserts `buildProxyUrls` output satisfies
  `isJbcentralProxyUrl`). **Read:** `isJbcentralProxyUrl(url)` (loopback host + `/wire/` path) — how the
  server's provider-status report detects a wired provider. **Write:** `wireJbcentral(env)` (probe the proxy
  secret via `central proxy start`, resolve the port, override anthropic/openai `baseUrl` in `models.json`
  → a `WireOutcome`: `connected` / `needs-install` / `needs-login` / `error`), `unwireJbcentral(env)` (undo),
  `isJbcentralInstalled()` (`Bun.which`), `launchJbcentralLogin()` (best-effort spawn of `central login`),
  plus the pure transforms + probe. **Install guidance is per-OS and single-sourced:** `jbcentralInstall(platform)`
  returns the `{platform, shell, command}` one-liner (macOS/Linux → `install.sh` curl pipe; Windows →
  `install.ps1` PowerShell) off the `central/` S3 path (post-rebrand, not the old `jbcentral/`); the server
  carries it to the web card over the wire (`ProviderStatusReport.jbcentralInstall`) so the browser never
  hard-codes (or guesses) the command.
  **The server's `auth` module is its sole caller:** the in-app "Connect JetBrains AI" flow composes
  `wireJbcentral`/`unwireJbcentral` and adds `modelRegistry.refresh()`.

## Get right (shellEnv)

- Runs **once at startup, before creating any `AgentSession`**.
- No-op on win32, or when PATH already contains a user dir (`/.nvm/`, `/homebrew/`, `/usr/local/bin`,
  `/.bun/`) — `pathLooksComplete()`.
- Else spawn a login shell `[$SHELL||/bin/zsh, -l, -i, -c, env -0]` (retry without `-i` on non-zero exit),
  5s timeout, parse the `\0`-separated entries, overwrite `process.env.PATH`. Never throws — on any
  failure it leaves PATH untouched.

## Get right (jbcentral)

- **Detect + invoke central by absolute path (`resolveJbcentralBin`), never by bare command.** Two traps,
  both of which caused an "installed but the in-app Recheck does nothing" bug: (1) `Bun.which(cmd)` with no
  options reads the PATH **snapshotted at process start**, not the live `process.env.PATH` — so we pass
  `process.env.PATH` explicitly; (2) the installer drops `central` in `~/.local/bin` and does **not** add
  that to PATH (it only prints a hint) — so we fall back to that location. `probeJbcentralSecret` /
  `launchJbcentralLogin` then run the resolved absolute path, so wiring/login work even when it's off PATH.
- **Back up `models.json` to `.bak` only once** (when no `.bak` exists) — a connect→disconnect→connect cycle
  must not overwrite the user's pristine pre-jbcentral backup with an intermediate managed state.

## Get right (freePort)

- Detect occupancy by **probing with a TCP connect**, not by catching a bind error: `Bun.serve` does not
  report `EADDRINUSE` for a busy `localhost` port on every platform (it can share the port via
  `SO_REUSEPORT`), so a bind-and-catch check is unreliable. A refused connection means free.
- `findFreePort` scans upward from `preferred` (predictable: `24242 → 24243 → …`) and falls back to an
  OS-assigned ephemeral port if the whole scan range is taken.
