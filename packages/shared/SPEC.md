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

Cross-cutting runtime utilities used by the engine host and its launchers. Server-side only — never
bundled into `apps/web`. Exposed through explicit subpath exports, not a barrel.

## Boundary

- **Owns:** host-side runtime helpers that are neither engine- nor transport-specific.
- **Public surface:** `@thinkrail/shared/shellEnv` → `resolveShellEnv()`, `pathLooksComplete()`,
  `localeRepair()`;
  `@thinkrail/shared/freePort` → `findFreePort()`, `isPortFree()`;
  `@thinkrail/shared/startupMark` → the static recursive wordmark plus the pure responsive/ANSI renderer
  and interactive-output gate used by every launcher;
  `@thinkrail/shared/paths` → the worktree-relative path conventions (`WORKSPACE_INTERNAL_DIR`,
  `WORKSPACE_CONTEXT_DIR`, `WORKSPACE_TODOS_DIR`);
  `@thinkrail/shared/codedError` → `CodedError` + `errorCodeOf()`;
  `@thinkrail/shared/jbcentral` → the native Central CLI adapter: absolute executable/version/status
  probing; the minimum supported version and the global opaque PI-extension path; a one-directional auth
  verdict; an artifact-location watcher; `add pi` / `remove pi` / `login` / `update --install` actions; and
  the per-OS official install plan. It never edits PI model or credential configuration.
- **Allowed deps:** Bun/Node runtime (`@types/bun`); `contracts` **types** (`JbcentralInstall`, the wire shape `jbcentralInstall`
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
- **/startupMark** — the launchers' one boot signature: a committed 42×20 `TR` silhouette built from a
  cyclic `THINKRAIL·` field, composed with the product identity, a caller-supplied honest status, and its
  resolved endpoint. At 72+ columns it is a right-hand lockup; from 42–71 it stacks, and below 42 it uses
  the identity/status alone rather than wrapping the artwork.
  Rendering is one synchronous write's worth of text: terminal-palette green + sparse bright signals +
  dim separators when ANSI is allowed, plain UTF-8 for `NO_COLOR`/`TERM=dumb`, and no mark at all for
  non-interactive stdout. The root dev runner calls it before spawning concurrent tasks (`starting`);
  the source/compiled CLI calls it after `bootHost` resolves the actual URL (`host ready`). SVG/image
  conversion is never a runtime concern.
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
  parses a bounded `central --version` result into a compatibility verdict, exposes the
  global opaque artifact path (`~/.pi/agent/extensions/jetbrains-central.ts`) and existence only, and invokes
  only the reviewed argv: `status`, `add pi`, `remove pi`, `login`, `update --install`, and
  `proxy start --ensure-updated`. Support is a **minimum version only** (`MINIMUM_CENTRAL_VERSION`,
  `1.4.0` — the first Central release carrying the native PI surface): anything at or above it is supported,
  lower versions require update, and malformed output is
  unsupported. There is deliberately **no upper bound** — a newer Central is assumed forward-compatible with
  the argv this adapter invokes, and gating on it would strand users behind every Central release.

  **Auth and proxy health are separate, one-directional observations from one status probe.** Until Central's
  requested JSON status surface ships, `central status` exits 0 across these states and emits styled
  presentation rows. The `Auth` verdict therefore trusts only its single negative marker: `not connected`
  means **signed out**, every other rendering of the row (account, licence, managed-server, or wording we
  have not seen) means **connected**, and a missing row or failed probe means **unknown**. The `Proxy`
  verdict similarly trusts only the exact stopped marker as **stopped**; running, missing, or unrecognised
  presentation collapses to **unknown/not-stopped**. Only those positively observed negative facts may drive
  a recovery demand. This is the only place presentation output is read, and the shared observation never
  returns raw text, port, PID, URL, account, licence, company, server details, or diagnostics. Swapping to
  JSON later remains internal to this boundary; every other command's output is still never parsed.
  The probe is expensive by Central's design (a proxy health check plus a network update check, ~1.3s, and one
  CLI analytics event per call), so `JBCENTRAL_STATUS_TTL_MS` bounds how long a caller
  may serve an observation before re-probing; nothing here polls.

  **A spawned login is not a started login.** `central login` drives its browser handoff from a terminal UI,
  so with no TTY it exits immediately and no sign-in happens — while the spawn itself succeeds. The launch
  therefore waits a grace period for an early exit and reports `launch-failed` on any non-zero one, so a
  caller can offer the command to run on the host instead of promising a browser that never opened. An
  immediate *zero* exit is Central's "already signed in" short-circuit and counts as launched; a flow that
  really started is still running when the grace elapses, because it is waiting on browser consent. The
  dependency seam exposes only the child's exit — never its output.

  **A timeout bounds the wait, not just the child.** Killing a child does not close a pipe its own
  grandchildren still hold open — and Central spawns a proxy daemon — so the deadline resolves the call
  outright rather than firing a kill and then awaiting the read. This is load-bearing because the version
  probe sits on the host's boot path: an unbounded wait there means no port, no UI, and no error to show.
  Version stdout is bounded in memory; action stdout/stderr is ignored. No child output is logged or returned, and only exit success plus safe
  postconditions map to a closed adapter outcome. `watchJbcentralArtifact(onChange)` observes only that
  reviewed location and reports invalidation events for add, remove, and replacement; it handles a not-yet-
  existing extension directory by re-arming from the nearest existing parent, and an existence-only poll
  repairs dropped add/remove filesystem events. It never opens or fingerprints the generated file. The caller
  debounces events and rechecks existence through the ordinary inspection API.

  The adapter deliberately has no migration path for the previous unpublished integration: it never reads or
  edits `models.json`, `auth.json`, backups, or any unrelated PI state.

  **Install guidance is per-OS and single-sourced:** `jbcentralInstall(platform)` returns the official host-OS
  plan carried to the card; a remote browser never guesses its own OS. **The server's `auth` module is the sole
  caller** and composes these host-local actions and watcher invalidations with `agent`'s runtime-generation
  seam.

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
  Watcher events are hints only: every rebuild re-inspects version + existence, and in-app actions explicitly
  request the same rebuild after their postcondition, so a dropped/coalesced filesystem event cannot lose a
  state transition.
- **Never return or throw raw child/loader data.** Adapter errors are closed codes with no free-form child
  text. The caller may report generic guidance only.
- **No legacy migration.** This is the first supported native integration; the adapter never touches prior
  provider overrides or maintains backup/rollback machinery.

## Get right (freePort)

- Detect occupancy by **probing with a TCP connect**, not by catching a bind error: `Bun.serve` does not
  report `EADDRINUSE` for a busy `localhost` port on every platform (it can share the port via
  `SO_REUSEPORT`), so a bind-and-catch check is unreliable. A refused connection means free.
- `findFreePort` scans upward from `preferred` (predictable: `24242 → 24243 → …`) and falls back to an
  OS-assigned ephemeral port if the whole scan range is taken.
