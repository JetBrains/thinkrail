---
id: submodule-server-terminal
type: submodule-design
parent: module-server
status: active
title: terminal — workspace PTYs
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Workspace-scoped `bun-pty` terminals rooted in the worktree cwd, and the per-workspace catalog of terminal
identities. A tab's shell outlives every client that looks at it; each frontend independently references its
`tabKey` from local workspace-view placement, which this module never receives.

## Boundary

- **Owns:** the persisted per-workspace terminal catalog (stable existence/metadata order, not visual
  workbench placement) and the PTY behind each tab, keyed by
  `(workspaceId, tabKey)`; batched output on `terminal.data` plus `terminal.exit` / `terminal.detached`
  (addressed) and `terminal.tabs` (broadcast), via injected publishers; the bounded per-terminal output
  recorder replayed on attach.
- **Public surface (barrel):** `reserveTerminal`, `attachTerminal`, `listTerminals`, `writeTerminal`,
  `resizeTerminal`, `closeTerminalTab`, `resumeClientTerminals`, `closeWorkspaceTerminals`,
  `persistTerminalSessions`, `reviveTerminalSessions`, `closeAllTerminals`, `resetTerminalState` (test seam),
  `setTerminalPublisher`,
  `setTerminalTabsPublisher`;
  the `TerminalDeliveryResult` type shared with the host publisher adapter.
- **Allowed deps:** `persistence`, `contracts` (`WS_CHANNELS`, `TerminalWindowsShell`), `bun-pty`,
  `Bun.which`, `process.env`.
- **Forbidden:** `host`; sibling features. No WebSocket type crosses this boundary — clients are opaque keys.

## Decisions

- **Shell selection is terminal-local**, and Windows' choice is additionally user-configurable
  (`AppConfig.terminalWindowsShell`, `apps/web/src/panels/TerminalSettings.tsx`'s Windows-only picker;
  [[task-windows-default-terminal-shell]]). Precedence, highest first: an explicit `SHELL` env var always
  wins (unchanged — the host does not invent a global `SHELL` on Windows, since it's a Unix login-shell
  convention and mutating it would affect the in-process agent and every unrelated child process merely to
  configure this module's PTY executable); then, on Windows only, `terminalWindowsShell`:
  - `"auto"` (default): `pwsh.exe` (PowerShell 7+) if `Bun.which` resolves it on PATH, else
    `powershell.exe`. No further fallback to `cmd.exe` — `powershell.exe` ships on every supported
    Windows release, so it is already the guaranteed floor. `defaultWhich` passes an explicit
    `{ PATH: process.env.PATH }` rather than calling `Bun.which` bare, the same trap `editors`'
    `defaultWhich` guards against: `Bun.which` alone reads the PATH snapshotted at process start, not
    `resolveShellEnv()`'s later-repaired live `process.env.PATH`.
  - `"pwsh"` / `"powershell"` / `"cmd"`: literal pins to `pwsh.exe` / `powershell.exe` / `cmd.exe` — no
    existence check, no silent substitution. A pin that turns out to be missing fails to spawn the same
    way a stale custom `SHELL` already does; not a new failure class, and the only mode with graceful
    substitution is `auto`.
  - Non-Windows platforms are unaffected: `/bin/bash` regardless of `terminalWindowsShell`.
  `cmd.exe` was the unconditional prior default; `"auto"`'s baseline is `powershell.exe`, a plain
  fallback swap (ships on every supported Windows release, so no new dependency), because it is more
  functional than `cmd.exe` (line editing, tab completion, VS Code's own default) with no downside for the
  default install. **The Windows default deliberately never consults `ComSpec`/`COMSPEC`**: that variable
  is virtually always the OS's own `cmd.exe` path — it names the interpreter for `cmd /c`/batch-file
  invocations, not a documented "pick my interactive shell" knob — so honoring it ahead of `powershell.exe`
  would leave the default unchanged for nearly every install; a user who deliberately swapped their command
  interpreter already has the `SHELL` override, and a second, weaker override would just be dead code. VS
  Code's own default Windows terminal profile detection makes the same call.
- **Known, accepted limitation: PowerShell weakens busy-close detection.** `closeTerminalTab`'s busy check
  (`shellBusy.ts`) counts the shell's OS child processes. Many PowerShell cmdlets do their work in-process
  rather than shelling out — `sleep` is a built-in alias for `Start-Sleep`, which blocks inside
  `powershell.exe` itself and spawns zero children, unlike `cmd.exe`'s external `sleep.exe` — so a
  PowerShell terminal genuinely busy in a native cmdlet (`Start-Sleep`, `Invoke-WebRequest`, `Copy-Item`,
  a dot-sourced script) can read as idle and be force-closed without warning. Everyday dev-tool invocations
  (`git`, `npm`, `bun`, `python`, `docker`, `node`, ...) are still external executables and stay correctly
  detected — this is a real but narrow gap, same accepted-limitation category as `shellBusy.test.ts`'s
  "an unanswerable platform reports not busy" case. A user who hits it can pick **Command Prompt (cmd)**
  and get the exact prior, fully-detectable behavior back.
- **Not building a `listAvailableShells`-style host probe** to gray out an uninstalled pick in the Settings
  picker, unlike `editors`' `listAvailableEditors`: `auto` already gets the graceful substitution most users
  want, and probing purely to decorate three static buttons wasn't asked for — a second detection mechanism
  earning less than it costs.
- **macOS PTYs start the user's shell in login mode (`-l`)** to match Terminal.app and the platform's
  terminal convention; other platforms keep a plain interactive shell. The PTY itself supplies
  interactivity, so no explicit `-i` is needed.
- **A shell is keyed by `(workspaceId, tabKey)`**, never by a socket, a client, or a component. `tabKey` is
  durable and client-supplied; PTY ids are per-run and **never persisted** (attaching to an id that outlived
  its process is Theia's `Couldn't attach - can't find terminal with id`).
- **Catalog reservation and PTY attachment are separate.** `reserveTerminal` idempotently records a
  client-minted tab identity without spawning. A new reservation is transactional: validate and insert,
  persist the complete catalog, then publish membership; persistence failure removes the in-memory insertion
  and publishes nothing. `attachTerminal` remains idempotent get-or-create and the only way a PTY is born.
  This is not a liveness split: a client still never holds the only pointer to a running shell.
- **The default terminal is a host-composed creation handshake, not layout seeding.** `host` sees the
  workspace's durable pending marker, calls `reserveTerminal` with its deterministic key, and asks
  `workspaces` to clear the marker only after catalog persistence succeeds. Retrying is idempotent; closing
  that terminal later cannot recreate it because the marker is already clear. This module never imports the
  workspace registry or chooses frontend placement.
- **Durable terminal identities are bounded.** A workspace catalog holds at most 256 tabs; a key is non-empty
  and at most 500 characters, and a title is non-empty and at most 1000 characters. Reservation and new attach
  share those checks. Revival truncates oversized catalogs, drops invalid keys, and repairs invalid titles
  before exposing host-authoritative membership.
- **Tracked-grid updates are change-only.** Each live entry tracks the grid applied at spawn or by the last
  successful resize. Attach and explicit resize advance that grid only when it changes, and failed calls do not
  advance it. A reattach may still perform a *transient* redraw nudge (below) that leaves the tracked grid
  untouched. Even a same-grid resize can wake the shell through `SIGWINCH`; a redraw emitted
  after the attach snapshot can overwrite freshly replayed rows.
- **Reattaching to an unchanged grid still nudges the foreground app** (`nudgePtyRedraw`, `ptyGrid.ts`):
  `TIOCSWINSZ` to the same size is a kernel no-op — no `SIGWINCH`, so a full-screen alt-screen app (vim,
  htop, an interactive CLI) left running behind a tab that was switched away and back gets no signal to
  repaint, and the recorder never captured its alt-screen content to replay in its place (see below) — the
  tab would otherwise show a frozen pre-alt-screen buffer. `attachTerminal`'s reattach branch resizes to
  `cols - 1` only when the real resize above was a no-op, forcing a genuine `SIGWINCH`; the restoring
  resize back to `cols` is **deferred** (`NUDGE_RESTORE_DELAY_MS`, `setTimeout`), not fired back to back
  with the first. Two `pty.resize()` calls in the same tick are, from the child's perspective, a single
  observable transition — its own event loop never gets scheduled between them — so an ncurses-style app
  ends up seeing "same size as before" and does its normal *incremental* refresh (diffing against what it
  last drew) instead of a full clear-and-redraw; that paints new content over whatever stale/blank buffer
  the client is currently showing rather than replacing it — visibly garbled, not merely stale, and worse
  than doing nothing. The deferred restore gives the child a real scheduling opportunity to observe — and
  fully redraw at — the intermediate size before the second resize lands. The restore checks liveness
  (`terminals.get(id) === entry`) before firing, since the tab may have closed or respawned in the
  interval, and it also checks that the tracked grid is still the one it captured: a real resize landing
  during the delay would otherwise be undone by the restore, leaving the PTY at the old size while the
  tracked grid says otherwise — and the change-only rule then makes retrying the new size a no-op. This is the same "redraw after the attach snapshot" class of race the bullet above already
  accepts, deliberately triggered every reattach instead of only incidentally.
- **Ownership is the host's owner, not the browser page.** Any client may attach; consistent with `history`,
  `todos` and `templates`, which already assume a single-owner host. Consequence: shells survive a reload, a
  closed browser and a different browser.
- **Attach is exclusive with takeover.** A PTY has one size, so a new attach becomes the recipient and the
  previous client gets `terminal.detached`. Mirroring is additive if ever wanted.
- **Only the attached client may drive a terminal.** `writeTerminal`/`resizeTerminal` take the caller and
  no-op otherwise: a displaced client keeps a valid PTY id and a reconnect replays its queued frames, which
  would land in whoever holds the tab now. Reclaiming is an explicit gesture, as in `tmux attach -d`. Such a
  caller is **re-told it is detached** — the original notice is fire-and-forget and can be lost (a client
  mid-reconnect during the takeover replays its attach and gets the cached success back), so learning on the
  first keystroke is what stops a tab looking live while nothing happens. The client also guards the reverse
  order with an attach generation, so a stale attach response can never clear a newer detach.
- **Output stays addressed**, never broadcast — a frame only ever reaches a client that attached. The tab
  *catalog* is the exception: which terminals exist is shared domain state (architecture #12), so every
  reservation or removal fans out on `terminal.tabs` as an idempotent per-workspace snapshot.
- **A shell dies from exactly five causes:** tab closed, workspace archived, natural exit, host stop, orphan
  sweep on attach. Unmounting a view kills nothing.
- **No idle culling.** Terminal "activity" can only mean last PTY I/O, so a quiet long-running command would be
  culled mid-flight (Jupyter's `cull_inactive_timeout` does exactly this). **No abandoned-client reap** either.
- **Revive, not reconnect, across a host restart.** Shells cannot survive it. **Membership is persisted on
  every change** (open / close / archive), not only at `stop()` — the host has no crash isolation, so an
  ungraceful exit is an ordinary path and a shutdown-only file would resurrect a closed tab and spawn a shell
  for it. `stop()` additionally captures a full set of recordings before `closeAllTerminals()`;
  `reviveTerminalSessions()` restores tabs whose first attach spawns a fresh shell showing the old picture.
  Recordings are best-effort, so an unclean exit gives back the right tabs with blank screens.
- **Not tmux.** Would buy restart survival at the cost of a dep we can't assume on Windows, a competing tab
  model, env-propagation breakage, and `capture-pane` polling. We already accept no crash isolation.

## Restrictions

- **`attachTerminal` and its handler must stay synchronous.** Lookup and insert in one tick is what makes
  attach atomic on Bun's single event loop; an `await` between them reintroduces double-spawn.
- **`closeTerminalTab` checks `busy` and kills in the same synchronous pass.** A separately-asked question
  lets a process started in between die unannounced.
- Recorder rules: raw bytes (not a serialized grid); never replay resize events; re-emit observed private
  modes **except mouse tracking (1000/1002/1003/1006)** — those belong to a live foreground program, and a TUI
  that exits without its own `DECRST` leaves the last observed value stuck at `on`, so re-emitting it into a
  fresh xterm at a bare prompt turns every mouse move into an SGR report the shell echoes back as garbage;
  **never record the alt screen**, tracking it as a *stream* since a switch can split across PTY reads
  and both screens can appear in one; **never record a mode sequence itself** (replaying `?1049h` would flip
  the fresh terminal to the alt screen); applied in one write on bind. **`restore()` parses what it is handed
  instead of copying it** — the persisted string is a `snapshot()`, so a verbatim copy moves its mode preamble
  into the body, where it stops being a re-derivable summary and becomes literal bytes that every later
  snapshot replays and re-persists: one bad mode then outlives the run that observed it, across restarts.
- Attach hands back the recording and then **discards** held batcher output — the replay already contains it.

## Validation

- `outputRecorder.test.ts` — bounds, line/escape-safe trimming, alt-screen exclusion (incl. a switch split
  across reads and enter+exit in one read), mode restoration, mouse tracking never restored, and `restore()`
  keeping mode sequences out of the body (incl. a recording persisted by a host that still replayed them).
- `outputBatcher.test.ts` — batching, backpressure, truncation, `reset`.
- `shellBusy.test.ts` — child detection, including that an unanswerable platform reports *not* busy.
- `shellArgs.test.ts` — shell executable precedence across Unix and Windows plus platform-specific
  arguments; `auto`'s pwsh-then-powershell resolution via an injected `WhichFn`; every explicit preference
  is a literal pin regardless of what `which` reports; `ComSpec`/`COMSPEC` no longer influence the result.
- `terminalManager.test.ts` — transactional durable reservation without spawn, catalog bounds, attach
  idempotency (incl. concurrent), takeover, displaced-client rejection, tab-list broadcast, close/busy,
  revive. Replay-persistence and natural-exit cases use bounded publisher-observed data/exit conditions as
  readiness edges, never elapsed time; their expected output marker never appears contiguously in the command
  input, so terminal echo cannot impersonate command execution.
- `e2e/terminals.spec.ts` — the rapid re-entry regression, reload survival, second-client takeover,
  cross-client tab convergence.
