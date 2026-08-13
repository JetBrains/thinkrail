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

Workspace-scoped `bun-pty` terminals rooted in the worktree cwd, **and the per-workspace list of terminal
tabs**. A tab's shell outlives every client that looks at it.

## Boundary

- **Owns:** the ordered per-workspace tab list (persisted) and the PTY behind each tab, keyed by
  `(workspaceId, tabKey)`; batched output on `terminal.data` plus `terminal.exit` / `terminal.detached`
  (addressed) and `terminal.tabs` (broadcast), via injected publishers; the bounded per-terminal output
  recorder replayed on attach.
- **Public surface (barrel):** `attachTerminal`, `listTerminals`, `writeTerminal`, `resizeTerminal`,
  `closeTerminalTab`, `resumeClientTerminals`, `closeWorkspaceTerminals`, `persistTerminalSessions`,
  `reviveTerminalSessions`, `closeAllTerminals`, `resetTerminalState` (test seam), `setTerminalPublisher`,
  `setTerminalTabsPublisher`;
  the `TerminalDeliveryResult` type shared with the host publisher adapter.
- **Allowed deps:** `persistence`, `contracts` (`WS_CHANNELS`), `bun-pty`, `process.env`.
- **Forbidden:** `host`; sibling features. No WebSocket type crosses this boundary — clients are opaque keys.

## Decisions

- **macOS PTYs start the user's shell in login mode (`-l`)** to match Terminal.app and the platform's
  terminal convention; other platforms keep a plain interactive shell. The PTY itself supplies
  interactivity, so no explicit `-i` is needed.
- **A shell is keyed by `(workspaceId, tabKey)`**, never by a socket, a client, or a component. `tabKey` is
  durable and client-supplied; PTY ids are per-run and **never persisted** (attaching to an id that outlived
  its process is Theia's `Couldn't attach - can't find terminal with id`).
- **`attachTerminal` is idempotent get-or-create** — the only way a PTY is born. No separate liveness call, so
  there is no window in which a client holds the only pointer to a running shell.
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
  *list* is the exception: which terminals exist is shared domain state (architecture #9), so every change
  fans out on `terminal.tabs` as an idempotent per-workspace snapshot.
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
  modes; **never record the alt screen**, tracking it as a *stream* since a switch can split across PTY reads
  and both screens can appear in one; **never record a mode sequence itself** (replaying `?1049h` would flip
  the fresh terminal to the alt screen); applied in one write on bind.
- Attach hands back the recording and then **discards** held batcher output — the replay already contains it.

## Validation

- `outputRecorder.test.ts` — bounds, line/escape-safe trimming, alt-screen exclusion (incl. a switch split
  across reads and enter+exit in one read), mode restoration.
- `outputBatcher.test.ts` — batching, backpressure, truncation, `reset`.
- `shellBusy.test.ts` — child detection, including that an unanswerable platform reports *not* busy.
- `terminalManager.test.ts` — attach idempotency (incl. concurrent), takeover, displaced-client rejection,
  tab-list broadcast, close/busy, revive.
- `e2e/terminals.spec.ts` — the rapid re-entry regression, reload survival, second-client takeover,
  cross-client tab convergence.
