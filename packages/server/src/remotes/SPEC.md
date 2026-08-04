---
id: submodule-server-remotes
type: submodule-design
status: draft
title: remotes — remote-check scheduler
parent: module-server
depends-on: [module-contracts]
tags: [v1, remote-awareness]
---

## Responsibility

Tells a project's git remotes apart from being stale without polling them constantly or all at once:
decides **when** a per-project "check the remotes" callback runs, never what that callback does. Built
in two halves that share this one `SPEC.md` (written in the first, extended by the second):

- **Mechanics (this half, landed):** the per-project floor, the jittered self-rescheduling backstop,
  start/stop lifecycle, the no-client-connected gate, and the `Promise` hygiene that keeps one project's
  failure from taking down another's check or the scheduling loop. Knows nothing about refs, credentials,
  trust, or dormancy — it is handed an opaque async `checkProject(projectId)` callback and decides only
  when to invoke it.
- **Policy (not yet landed — see "Not yet implemented" below):** deriving which refs to check from each
  project's workspaces, the credential ladder's dormancy reasons, per-pair exponential backoff, turning
  probe/fetch results into `RemoteState`, and publishing it.

## Boundary

- **Owns (mechanics half):**
  - **Per project, never per workspace** — worktrees inside one project share a single `.git`, so there is
    exactly one floor/backstop cadence per project id, however many workspaces (worktrees) it has open.
  - The **60s minimum-interval floor** (`MIN_CHECK_INTERVAL_MS`): however many triggers ask for a given
    project inside this window (an activity sweep, `checkNow`, the backstop tick), only the first actually
    invokes `checkProject`; the rest resolve immediately. Fixed, not configurable — `AppConfig` carries no
    floor knob, only the backstop interval does.
  - The **jittered backstop**: a self-rescheduling `setTimeout` (never `setInterval` — this repo has none,
    and a self-rescheduling one-shot is what lets the jitter differ every round) whose delay is
    `intervalMs * (1 + JITTER_FRACTION * draw)`, `draw` ∈ `[0, 1)`, `intervalMs` from the host-injected
    `AppConfig.gitRemoteCheckIntervalMinutes`. The jitter exists to stop many installs' backstops from
    synchronising onto the same instant (the anti-thundering-herd rationale GitHub Desktop's own skewed
    polling interval is built on).
  - **Start/stop lifecycle**: `startRemoteChecks(deps)` installs the (test-overridable) dependencies and
    arms the first backstop tick, without itself invoking any check. `stopRemoteChecks()` clears the
    pending timer; a real-clock race (the OS timer had already fired before `clearTimeout` took effect) is
    handled too — a stopped scheduler's tick is a no-op and, critically, never reschedules itself. This is
    what lets `server.stop()` prove no live timer survives.
  - **The no-client gate**: nothing runs — not even the backstop — until `noteClientActivity()` has been
    called at least once. There is no "last client left" signal owned here (this module has no WS
    lifecycle edge), so the gate only ever latches on, never back off.
  - **`Promise` hygiene**: `checkProject`'s failure is caught at the single funnel every trigger goes
    through, never at the caller — and "failure" means both an async rejection AND a SYNCHRONOUS throw
    (the call is routed through an already-resolved `.then`, since `CheckProjectFn`'s type promises a
    `Promise<void>` but cannot enforce that at runtime; a non-`async` implementation that throws before
    ever constructing one must be caught exactly like a rejection). One project's failing check can never
    propagate into another project's check, or abort the `for` loop sweeping the remaining projects in
    the same activity/backstop pass, or kill the backstop's self-rescheduling loop.
  - `configureRemoteChecks(config)` applies the host's config: only reads `gitRemoteCheckIntervalMinutes`,
    and rearms the backstop immediately when already running (a live interval change, e.g. a Settings
    edit, takes effect at once rather than waiting out whatever was left of the old interval).
- **Explicitly not owned by the mechanics half:** *what* `checkProject` does (refs, git, credentials),
  *why* a pair isn't being checked (dormancy reasons), and *what changed* (there is no `RemoteState` model
  or publish seam here yet — see "Not yet implemented").
- **The clock, the scheduler timer, and the jitter draw are all injected** (`now`, `setTimer`/`clearTimer`,
  `random` on `RemoteCheckDeps`, each defaulting to `Date.now`/`setTimeout`+`clearTimeout`/`Math.random`),
  so every timing rule is provable without a test ever sleeping.
- **Config arrives by injection from `host`, exactly as `setAnalyticsSending` already does — never by
  reading `settings` directly.** `configureRemoteChecks` takes the already-validated `AppConfig`
  (`settings.updateConfig` clamps `gitRemoteCheckIntervalMinutes` to `[1, 1440]` and validates
  `gitRemoteCheck` before this module ever sees it) and does not re-validate. `settings` must never import
  `remotes`, nor vice versa (mirrors `settings/SPEC.md`'s own statement of this boundary).
- **`gitRemoteCheck` (`"probe" | "fetch" | "off"`) is read by neither half's timing.** `"off"` is a
  dormancy reason (`disabled`), which is the policy half's responsibility to report per pair — the
  scheduler keeps inviting `checkProject` on schedule regardless of this value, so a disabled mode is
  reported honestly by the callback, never by this module silently going dark. (Recorded here so the
  policy half doesn't have to rediscover why `configureRemoteChecks` ignores this field.)
- **Public surface (barrel, mechanics half):** `configureRemoteChecks`, `startRemoteChecks`,
  `stopRemoteChecks`, `checkNow`, `noteClientActivity`, plus the exported types `CheckProjectFn`,
  `RemoteCheckDeps`, `TimerHandle`, and the constants `MIN_CHECK_INTERVAL_MS`, `JITTER_FRACTION`.
- **The `checkProject` callback signature the policy half must match:**
  `type CheckProjectFn = (projectId: string) => Promise<void>` — one project id in, resolves when that
  project's check (however many ref pairs it covers) is done; a rejection is caught by this module, so the
  callback is free to reject rather than swallow its own errors.
- **Allowed deps:** `persistence` (`loadProjects` — enumerating which project ids exist to sweep on
  activity/backstop; worktrees share one `.git`, so this is read at the project level, never per
  workspace), `contracts` (`AppConfig`, `DEFAULT_CONFIG`). The policy half additionally needs `git`
  (`probeRemoteRefs`, `fetchRemoteRefs`, `behindCount`, `remoteUrlKind`, `sshAgentPresent`, `diffBaseRef`),
  `persistence` (`isRemoteTrusted`, `loadWorkspaces`), and `@thinkrail/shared` — none of which the
  mechanics half reaches today.
- **Forbidden:** `host` (config and any future publish seam are both injected, never read by importing
  `host`); `settings` (see above); sibling feature modules (`git`, `workspaces`, … are the policy half's
  concern, not this half's).

## Not yet implemented (policy half — a follow-up task)

- `remoteStateFor(projectId)` / `setRemoteStatePublisher(fn)` — the read + push seam for `RemoteState`.
  Requires the `RemoteState` data model (already landed in `contracts`) and the logic that computes it.
- Deriving the refs to check from a project's workspaces' `diffBaseRef` (only the distinct
  remote-tracking, `origin/…`-shaped ones).
- Dormancy: `never-authenticated` / `ssh-agent-present` / `disabled` / `failing`, each explicit and
  reasoned — never silent idleness — including the credential ladder (`isRemoteTrusted`, `remoteUrlKind`,
  `sshAgentPresent`) and per-pair exponential backoff on repeated failure.
- Turning a probe/fetch result into `RemoteState.behind` (`"unknown"` in probe mode when a ref differs,
  an exact count in fetch mode, `null` when up to date).
- Host wiring (`server.ts` calling `startRemoteChecks`/`configureRemoteChecks`, a settings-change tee) —
  out of scope for both halves per the plan; a later task.

## Get right

- **The floor is measured from when a check STARTS, not when it finishes** — two near-simultaneous
  triggers for the same project must not both slip through before either resolves; the floor timestamp is
  written before `checkProject` is even called.
- **`noteClientActivity()` takes no project id** (matches the brief's produced surface) — it latches the
  gate and immediately sweeps every currently-known project through the same floored path as every other
  trigger, so a burst of nudges (focus, reconnect) collapses to at most one check per project, not one per
  nudge.
- **A fresh `startRemoteChecks` call clears all per-project floor/in-flight state** — a previous life's
  (e.g. a previous test's) timing must never suppress the first real check of a new run.
