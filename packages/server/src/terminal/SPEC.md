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
  `closeWorkspaceTerminals` + `closeAllTerminals` + `setTerminalPublisher`; the `TerminalDeliveryResult` type
  shared with the host publisher adapter (no WebSocket type crosses this boundary).
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
- Delivery has three explicit outcomes: **delivered**, **backpressured** (this frame was accepted, but no more
  may be sent), and **unavailable** (this frame was not accepted). The host maps Bun's `send()` statuses
  correctly (`>0`, `-1`, `0`) and latches per-client backpressure until `drain`/reconnect; a batcher likewise
  stops retrying while blocked. A batch the owner cannot take is **kept and retried**
  (`resumeClientTerminals`), so a brief disconnect no longer leaves a silent hole in the scrollback. Held
  output is capped; past the cap the **oldest** is dropped and the next batch is flagged `truncated` so the
  client can say so rather than appearing to have simply printed less.

A natural PTY exit moves its final pending output plus `terminal.exit` into one per-client completion queue.
The data must be accepted before the exit can be accepted, including across reconnect/backpressure, so a
command cannot return with only its death notice and no final result. Intentional close/archive/shutdown instead
discards pending output. A client reaped as abandoned drops its completions — there is nobody to tell.

`terminal.alive` closes the matching gap on the client's side: `terminal.exit` is only heard by a *mounted*
terminal, and a tab detaches its PTY precisely when none is mounted, so a shell that died while detached must be
detected by asking rather than by having been told.

Every intentional path that kills a PTY disposes its batcher, so held output is dropped rather than delivered
against a terminal that no longer exists. Natural exit is the one exception: `finish()` transfers the pending
batch into the ordered completion above before the batcher is retired.
