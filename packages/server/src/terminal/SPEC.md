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

Workspace-scoped `bun-pty` terminals, each rooted in the worktree cwd; their output streams to the one client
that owns them.

## Boundary

- **Owns:** PTYs keyed by id, each tagged with its `workspaceId` **and its owning `clientKey`**; output batched
  and pushed on the `terminal.data` channel plus a `terminal.exit` announcement, both via an injected
  publisher; `createTerminal`/`writeTerminal`/`resizeTerminal`/`closeTerminal`,
  `resumeClientTerminals(clientKey)`, `closeClientTerminals(clientKey)`,
  `closeWorkspaceTerminals(workspaceId)` (kill the workspace's PTYs when it's **archived**, so no shell orphans
  on a now-deleted worktree dir — the host calls it before removing the worktree), `closeAllTerminals()` on
  shutdown, `setTerminalPublisher`.
- **Public surface (barrel):** the four terminal operations + `isTerminalAlive` (serves `terminal.alive`, the
  liveness check a re-attaching tab must pass — see below) + `resumeClientTerminals` + `closeClientTerminals` +
  `closeWorkspaceTerminals` + `closeAllTerminals` + `setTerminalPublisher`.
- **Allowed deps:** `persistence` (worktree cwd lookup); `contracts` (`WS_CHANNELS`); `bun-pty`; `process.env`.
- **Forbidden:** `host`; sibling features. The module never learns what a WebSocket is — it addresses a client
  by opaque key through the injected publisher.

## A terminal belongs to one client

Every operation is checked against the caller's `clientKey`, and output is **addressed**, never broadcast.
Previously each PTY's bytes went to a single topic every socket subscribed to, leaving each browser to discard
the frames that weren't its own — so every connected client received everything typed or printed in every
terminal of every workspace. An id the caller doesn't own is treated exactly like one that doesn't exist, so
probing ids reveals nothing about which exist.

Ownership is keyed to a **client id that survives reconnects** (`?client=` on the socket URL), not to the
socket. This is load-bearing in both directions: the client reconnects on its own, so socket-keyed ownership
would silently orphan a shell on any network hiccup, while an id that also survived a reload could never be
reaped. `closeClientTerminals` therefore runs on a **grace timer** (`host/server.ts`), not on socket close.

## Output is batched, and cannot be pushed back on

`bun-pty` exposes no `pause()`/`resume()` and starts its read loop at spawn, so the host **cannot slow a shell
down** — `yes` or a huge `cat` will be read as fast as it is produced. Two consequences, both handled in
`outputBatcher.ts` (timer-only and transport-free, so it is unit-tested directly):

- Reads are grouped into whole frames instead of one frame per read.
- A batch the owner cannot take is **kept and retried** (`resumeClientTerminals` on reconnect), so a brief
  disconnect no longer leaves a silent hole in the scrollback. Held output is capped; past the cap the
  **oldest** is dropped and the next batch is flagged `truncated` so the client can say so rather than
  appearing to have simply printed less.

An **exit** the owner could not take is held per client and retried on reconnect too, for the same reason: a
shell dying during a hiccup would otherwise leave a tab believing it was alive forever, which is exactly what
`terminal.exit` exists to prevent. A client reaped as abandoned drops its held exits — there is nobody to tell.

`terminal.alive` closes the matching gap on the client's side: `terminal.exit` is only heard by a *mounted*
terminal, and a tab detaches its PTY precisely when none is mounted, so a shell that died while detached must be
detected by asking rather than by having been told.

Every path that kills a PTY disposes its batcher, so held output is dropped rather than delivered against a
terminal that no longer exists. (The cancelled flush timer is incidental — `flush()` is a no-op on an empty
buffer, so a missed `clearTimeout` would cost one idle timer for `flushMs`, not correctness. Dropping the
**buffer** is the part that matters, and is what the unit test pins.)
