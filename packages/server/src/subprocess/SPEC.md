---
id: submodule-server-subprocess
type: submodule-design
status: active
title: subprocess — bounded child processes
parent: module-server
depends-on: []
tags: [v1, host]
---

## Responsibility

Run one child process to completion under a wall-clock budget, and return what it wrote. The single
answer to "how does this host spawn something that might never come back" — the lifetime mechanics only,
never what a particular child's output means.

## Boundary

- **Owns:** `runBounded(argv, { timeoutMs, cwd?, env? })` → `{ ok, out, err, timedOut, waitedMs }`: spawn
  detached, capture both streams, complete on the child's **exit**, and on expiry kill the whole process
  group. A failed launch is a result (`ok: false`, the launch error as `err`), never a throw.
- **Public surface:** `runBounded`, `BoundedRun`, `BoundedRunOptions`.
- **Allowed deps:** Bun/Node process APIs. Nothing else — it knows no feature, no wire type, no
  persistence.
- **Forbidden:** message wording, retry, truncation, or any policy about a specific program. `git`'s
  stalled/stderr text and `branch-review`'s degrade-to-`null` are the callers' business.
- **Known non-consumers.** Three callers spawn something that can outlast a human's patience and still do
  it themselves, each deliberately and each a standing debt rather than a settled design:
  - `@thinkrail/shared/jbcentral` — already deadline-first, and a different contract (bounded-byte reads, a
    closed outcome vocabulary, an injectable `run` seam, Central's confidentiality rules). Folding it in
    would grow this surface for one caller in another package.
  - `dialog`'s `selectDirectory` (`dialog.ts`) — still the EOF-gated shape this module replaces, around
    `zenity`/`kdialog`/`osascript`, whose forked helpers inherit stdio. Unmigrated because a picker's real
    budget is a human at a dialog: it needs a cancellation seam, which `runBounded` does not offer.
  - `github`'s `githubAuthStatus` (`github.ts`) — a `spawnSync` HTTPS call on the single event loop, so it
    also caps this module's guarantee: while it blocks, no `runBounded` deadline can fire. Migrating it
    means making the call async first, which changes its handler on the wire side.

  The census above is about *unbounded waits*, not about every spawn in the repo — the rest are already
  bounded or cannot wait on anything: `git`'s sync `git()` and `shared/shellEnv` pass their own
  `Bun.spawnSync` timeout, `terminal/shellBusy` shells out to `pgrep` locally, and `editors`,
  `cli/bootstrap` and `cli/powershell` are fire-and-forget `.unref()`s whose output nobody reads.
  `agent/trash`'s `execFile` is the one true straggler: unbounded, but a local trash helper with no
  network and no prompt, so it fails the letter of this module and not its purpose.

## Get right

- **Completion is the child exiting, never its pipes reaching EOF.** A grandchild that inherits the child's
  `stdout`/`stderr` and outlives it holds the write end open, so an EOF-gated read never returns — and
  because the read *was* the completion signal, a child that finished successfully in milliseconds was
  reported as a full-budget timeout (`git` + a backgrounded `ssh`, issue #209's second face). `Bun.spawn`'s
  own `timeout` option gates the same way and is not an alternative.
- **The deadline races the child's *exit*, and the drain grace runs after that race is decided.** The
  grace is not part of the budget: racing the deadline against the *post-grace* settle instead turned the
  last `DRAIN_GRACE_MS` of every budget into a false-timeout window, because a grandchild holding the pipes
  makes the grace run to full term every time. A `git fetch` that answered at 54.9s of its 55s came back as
  the stalled wording with `ok: false`, and its healthy process group was SIGKILLed on the way out. Pinned
  by a test whose child exits immediately behind a pipe-holding grandchild under a 250ms budget.
- **The drain grace (250ms) runs on *both* outcomes, exit and expiry.** It cannot truncate the child's own
  output: a pipe holds at most its buffer, and a child that writes more than that is *blocked* until the
  reader drains it — so at exit everything left is already buffered and drains in microseconds; the grace
  only covers scheduler latency. Anything arriving after it can only come from a process that is not our
  child — and is still captured as if it were the child's, which is a known wart, not a guarantee. The
  constant is pinned from the other side: a test asserts each path *waits it out* (and no longer) when a
  grandchild keeps the pipes from ever reaching EOF, which is the only case where it is observable at all.
- **The timeout path drains too — cancelling the readers on the spot dropped the diagnosis.** The group
  kill is what closes the write ends, so the bytes still in the pipe at expiry are exactly the ones the
  caller's message is built from: git's `Permission denied (publickey)`, a proxy's refusal, a `remote:`
  progress line proving a large transfer was simply still running. Killing and then cancelling in the same
  synchronous step raced a pending `read()` against that cancel and could throw the last chunk away —
  a caller promising "whatever git wrote before the kill" while dropping git's last word. Post-kill the
  reads hit EOF almost at once, so the grace costs nothing in the normal case and caps the pathological one
  (a holder that escaped the group via its own `setsid`, which is what the test uses to make the wait
  observable).
- **`timeoutMs` is clamped before it reaches `setTimeout`.** The type says `number`, and `setTimeout`
  silently collapses `Infinity`, `NaN`, negatives, and anything ≥ 2^31 to ~1ms — so `Infinity`, the natural
  spelling of "no budget", bought an instant timeout, an immediate group-`SIGKILL` of a healthy child, and
  a `TimeoutOverflowWarning` on the host's stderr. Non-finite now means the longest budget `setTimeout` can
  hold (~24.8 days) — the only reading of "no budget" that is not a lie. `NaN` is **not** given that
  reading: "not a number" is a broken caller, and the safe failure for a broken budget is to expire at
  once, not to wait 24 days. Finite values clamp into `[0, 2^31-1]`, and a negative budget expires
  immediately because it already had.
- **On expiry, kill the process group — that, not the timer, is what releases the descriptors.**
  `detached: true` (`setsid`) makes the child a group leader, so `process.kill(-pid, "SIGKILL")` reaps the
  grandchildren still holding our pipes; the reads then hit EOF on their own. Abandoning reads instead is
  what pins Bun's event loop for the orphan's whole lifetime — measured at a 20s hold against an unref'd
  400ms timer, and ~1.4 descriptors leaked per stall. Reaping the group instead leaves nothing resident:
  no surviving grandchild, no descriptor growth, and the host free to exit.
- **The exit path never kills the group.** The grandchildren there are healthy and deliberate — an `ssh`
  `ControlMaster`, a credential-cache daemon — and killing them would cost the user their multiplexed
  connection or their cached credentials for a call that *succeeded*. The readers are cancelled instead.
- **`setsid` drops the controlling terminal — a deliberate trade, not a free win.** A child can no longer
  open `/dev/tty` to prompt, which is what turns issue #209 from a 55s wait into an immediate
  `Permission denied (publickey)` for most users; `SSH_ASKPASS` is unaffected (no-tty is exactly its
  trigger), which is why the caller's budget still has to be sized for a human at a dialog. **What it costs
  is real:** V1's entrypoint is a `thinkrail` bin launched from a terminal that stays in the foreground, and
  a user sitting there could until now *see* `ssh`'s `Enter passphrase for key …` on `/dev/tty` (ssh reads
  the tty directly, so our piped stdio never hid it) and type it. They no longer can. Accepted because the
  UI is a browser client and a hidden terminal prompt is not a flow it can ever show, wait on, or report —
  a fast legible failure beats a prompt only the launching shell can see. It also puts the child outside the
  host terminal's signal group, so the budget — never a `Ctrl-C` on the host — is what ends a stalled call.
  Surfacing the passphrase request in the UI (#209's headline ask, as opposed to its "at minimum" clause)
  stays unbuilt and needs the cancellation seam `dialog` wants above.
- **Windows has no process groups.** `detached` maps to `UV_PROCESS_DETACHED` and the kill falls back to
  the direct child, so a grandchild there survives the timeout as before. The group-kill test is skipped
  there rather than pretending otherwise. Bounded children use `windowsHide` on Windows: background
  lookups must not create a visible console window or steal focus from the browser client.
- **The env defaults to the live `process.env`, not Bun's launch-time snapshot** — `boot`'s
  `resolveShellEnv()` repairs `PATH`/`LANG` by mutating `process.env` *after* startup, and a child spawned
  from the snapshot silently misses that repair. Both halves are pinned separately — a caller's `env`/`cwd`
  arriving at the child, and a post-startup mutation being visible to one spawned without `env` — because a
  test that only asserts the defaults cannot tell the two apart.
- `stdin` is always `ignore`, and both output streams are always piped and **read from the moment of
  spawn**, decoded incrementally — an undrained pipe is how a chatty child deadlocks. The readers are
  cancelled once the outcome is decided *and* the grace above has run, never before it. Every
  timer is `unref`'d, so a bounded wait never holds shutdown open, and `waitedMs` comes from
  `performance.now()`, so a clock adjustment cannot render a negative wait.
- **Neither stream is capped.** `runBounded` accumulates whatever the child writes for as long as the
  budget allows, so a caller's byte ceiling (`git`'s 2000-char `boundedStderr`) bounds what reaches a
  client, never what this module holds in memory. Adequate for `git`/`gh`/`glab`, where the worst case is a
  progress log measured in hundreds of KB; a caller that can spew unboundedly needs a `maxBytes` option
  here rather than a truncation after the fact.
