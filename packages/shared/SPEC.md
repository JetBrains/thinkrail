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
- **Public surface:** `@thinkrail/shared/shellEnv` → `resolveShellEnv()`, `pathLooksComplete()`,
  `localeRepair()`;
  `@thinkrail/shared/freePort` → `findFreePort()`, `isPortFree()`;
  `@thinkrail/shared/paths` → the worktree-relative path conventions (`WORKSPACE_INTERNAL_DIR`,
  `WORKSPACE_CONTEXT_DIR`, `WORKSPACE_TODOS_DIR`);
  `@thinkrail/shared/codedError` → `CodedError` + `errorCodeOf()`;
  `@thinkrail/shared/jbcentral` → the native Central CLI adapter: absolute executable/version/status
  probing; reviewed version bounds and the global opaque PI-extension path; `add pi` / `remove pi` /
  `login` / `update --install` actions; the per-OS official install plan; and the transactional exact cleanup
  of ThinkRail's legacy `models.json` fields.
- **Allowed deps:** Bun/Node runtime (`@types/bun`); `proper-lockfile` for bounded cross-process ownership of
  legacy `models.json` edits; `contracts` **types** (`JbcentralInstall`, the wire shape `jbcentralInstall`
  returns — kept in the wire so the server can carry it to the card verbatim).
- **Forbidden:** importing `server` / `web` / any `pi` package; being imported by `web` (it carries
  Bun/Node code that must not reach the browser bundle).

## Contents

- **/shellEnv** — `resolveShellEnv()`: make the host's environment safe for the shells it spawns, because a
  GUI-launched host (Finder/Dock, launchd, a systemd unit, a container) inherits a stripped-down one. Two
  independent repairs, each applied only when needed:
  - **`PATH`** — ensure it is the user's full login PATH so the in-process agent's bash/tools find
    `git`/`node`/etc. Skipped when `pathLooksComplete()`.
  - **locale** — set `LANG` to a UTF-8 locale when *no* locale is configured at all (`LC_ALL`, `LC_CTYPE`
    and `LANG` all unset). Without one, bash/readline is **byte**-oriented rather than character-oriented,
    so one backspace over a multi-byte character (Cyrillic, umlauts, CJK) deletes half of it and desyncs the
    line. Only `LANG` is set, never `LC_ALL`, so a user's per-category settings (`LC_NUMERIC`, `LC_TIME`, …)
    survive.

  Both repairs land on `process.env`, which is what makes them reach *every* shell the host spawns: the PTY
  terminals copy it (`server/src/terminal`), and so does the in-process agent's own bash.
- **/freePort** — `findFreePort(preferred, host?)`: the first free port at or above `preferred`, so a
  host can pick an open port instead of colliding with one already running. `isPortFree(port, host?)`:
  the underlying single-port check.
- **/codedError** — `CodedError(code, message)` + `errorCodeOf(err)`: an error carrying a wire
  `WsErrorCode`, so a failure a client must react to *specifically* travels as a name rather than a string
  to pattern-match. It lives here because both ends of the seam need it and neither may import the other:
  the module that knows the failure throws it (today `server/src/git`, for a vanished commit scope) and the
  host's request handler reads it onto `WsResponse.errorCode`.
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
- **/jbcentral** — the **single Central process/filesystem boundary**. It resolves Central by absolute path,
  parses a bounded `central --version` result into an exact reviewed compatibility verdict, exposes the
  global opaque artifact path (`~/.pi/agent/extensions/jetbrains-central.ts`) and existence only, and invokes
  only the reviewed argv: `add pi`, `remove pi`, `login`, and `update --install`. The initial supported range
  is exactly `1.6.2`; lower versions require update, higher versions are unreviewed, and malformed output is
  unsupported. Human presentation output is never parsed. Version stdout is bounded in memory; action
  stdout/stderr is ignored. No child output is logged or returned, and only exit success plus safe
  postconditions map to a closed adapter outcome.

  The same module owns migration of the old ThinkRail writer. Cleanup runs only after native `add pi`
  succeeds and removes a provider's fields only when they jointly match ThinkRail's exact former pair:
  `apiKey === "wire-proxy"` and the complete loopback URL grammar ThinkRail emitted for that provider
  (`anthropic` and `openai` have distinct fixed suffixes). A generic loopback `/wire/…` URL, a partial match,
  or any unrelated field is preserved. Cleanup and rollback take the same bounded `proper-lockfile`
  interprocess lock on `models.json` before reading, validating, and publishing; the in-process queue is only
  an additional ordering guard. Under that writer lock, the edit is compare-and-swap guarded, atomically
  published with the original permissions, and leaves the existing `.bak` untouched. Repeated uncoordinated
  changes still return a typed conflict outcome rather than overwriting the file. The transaction can restore only the exact
  fields it removed, and only while the file still matches its committed state; it never restores a whole
  backup.

  **Install guidance is per-OS and single-sourced:** `jbcentralInstall(platform)` returns the official host-OS
  plan carried to the card; a remote browser never guesses its own OS. **The server's `auth` module is the sole
  caller** and composes these host-local actions with `agent`'s runtime-generation coordinator.

## Get right (shellEnv)

- Runs **once at startup, before creating any `AgentSession`**.
- No-op on win32, or when PATH already contains a user dir (`/.nvm/`, `/homebrew/`, `/usr/local/bin`,
  `/.bun/`) — `pathLooksComplete()`.
- Else spawn a login shell `[$SHELL||/bin/zsh, -l, -i, -c, env -0]` (retry without `-i` on non-zero exit),
  5s timeout, parse the `\0`-separated entries, overwrite `process.env.PATH`. Never throws — on any
  failure it leaves PATH untouched.

## Get right (jbcentral)

- **Detect + invoke Central by absolute path (`resolveJbcentralBin`), never by bare command.** Pass the live
  `process.env.PATH` to lookup and retain the official `~/.local/bin/central` fallback, because a long-running
  host must see a just-installed executable without restart.
- **Confidential-source-informed, public-surface-only.** Tracked artifacts contain only reviewed argv,
  compatibility bounds, the opaque path, typed outcomes, and independently authored fakes. Never copy or
  paraphrase Central source/output, and never read, parse, hash, snapshot, copy, log, upload, persist elsewhere,
  or serve the generated extension.
- **No standalone PI dependency.** Central writes global PI configuration; ThinkRail loads its path into the
  embedded PI runtime, including when `PI_CODING_AGENT_DIR` points elsewhere and no `pi` command exists.
- **Never return or throw raw child/loader data.** Adapter errors are closed codes with no free-form child
  text. The caller may report generic guidance only.
- **Legacy migration is field-transactional.** Preserve unrelated providers/fields and the existing `.bak`;
  on later activation failure, conditionally restore only this invocation's removed fields.

## Get right (freePort)

- Detect occupancy by **probing with a TCP connect**, not by catching a bind error: `Bun.serve` does not
  report `EADDRINUSE` for a busy `localhost` port on every platform (it can share the port via
  `SO_REUSEPORT`), so a bind-and-catch check is unreliable. A refused connection means free.
- `findFreePort` scans upward from `preferred` (predictable: `24242 → 24243 → …`) and falls back to an
  OS-assigned ephemeral port if the whole scan range is taken.
