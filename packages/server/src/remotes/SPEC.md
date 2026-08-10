---
id: submodule-server-remotes
type: submodule-design
status: active
title: remotes — remote-check scheduler
parent: module-server
depends-on: [module-contracts]
tags: [v1, remote-awareness]
---

## Responsibility

Tells a project's git remotes apart from being stale without polling them constantly or all at once:
decides **when** a per-project "check the remotes" callback runs, never what that callback does. Built
in two halves that share this one `SPEC.md` (written in the first, extended by the second):

- **Mechanics (`remotes.ts`, landed):** the per-project floor, the jittered self-rescheduling backstop,
  start/stop lifecycle, the no-client-connected gate, and the `Promise` hygiene that keeps one project's
  failure from taking down another's check or the scheduling loop. Knows nothing about refs, credentials,
  trust, or dormancy — it is handed an opaque async `checkProject(projectId)` callback and decides only
  when to invoke it.
- **Policy (`policy.ts`, landed):** deriving which refs to check from each project's workspaces, the
  credential ladder's dormancy reasons (with a fixed precedence when several apply at once), per-pair
  exponential backoff with quiet recovery, turning a probe/fetch result into an honest `RemoteState`, and
  publishing it. Supplies the real `checkProject` the mechanics half invokes on a schedule.

## Boundary

- **Owns (mechanics half):**
  - **Per project, never per workspace** — worktrees inside one project share a single `.git`, so there is
    exactly one floor/backstop cadence per project id, however many workspaces (worktrees) it has open.
  - The **60s minimum-interval floor** (`MIN_CHECK_INTERVAL_MS`): however many *recurring* triggers ask for
    a given project inside this window (an activity sweep, `checkNow`, the backstop tick), only the first
    actually invokes `checkProject`; the rest resolve immediately. Fixed, not configurable — `AppConfig`
    carries no floor knob, only the backstop interval does. **One trigger skips the floor** (never the
    in-flight de-dupe): a **`gitRemoteCheck` mode change**, which sweeps every known project at once. The
    floor exists to collapse repeated automatic nudges; a mode change is a rare, deliberate edit after
    which every published `RemoteState` describes the wrong mode (`"off"` must become `dormant: "disabled"`,
    and leaving it must clear that), and floor-gating it would silently drop the update exactly when a user
    toggles the setting seconds after a check ran. An **interval-only** edit does not sweep — it changes
    cadence, not what any pair's state means, and a settings save must not become a fleet-wide network round.
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
  *why* a pair isn't being checked (dormancy reasons), and *what changed* — all of that is the policy
  half, below.
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
  reported honestly by the callback, never by this module silently going dark.
  `configureRemoteChecks` additionally caches the mode itself (`currentGitRemoteCheckMode()`, an
  internal, non-barrel export) purely so the policy half can read it without either half importing
  `settings` — the mechanics half still never branches on it for scheduling.
- **Public surface (barrel, mechanics half):** `configureRemoteChecks`, `startRemoteChecks`,
  `stopRemoteChecks`, `checkNow`, `noteClientActivity`, plus the exported types `CheckProjectFn`,
  `RemoteCheckDeps`, `TimerHandle`, and the constants `MIN_CHECK_INTERVAL_MS`, `JITTER_FRACTION`.

- **Owns (policy half, `policy.ts`):**
  - **Ref derivation**: for a project, the *distinct* `diffBaseRef(ws)` (the `git` module's collapse
    point — never re-derived as `diffBase ?? baseBranch`) across every one of that project's workspaces,
    kept only when it's remote-tracking-shaped (`"origin/…"` — this repo hardcodes a single remote named
    `origin` everywhere else too, e.g. `git.ts`'s `listBranches`/`resolveDefaultBranch`/`prefetchBranch`,
    so this filter is consistent with the rest of the codebase, not a new assumption). A local branch
    base (`"feature/x"`) is dropped: there is nothing remote to check it against.
  - **The credential ladder, checked in a fixed order, cheapest/most-totalizing first** — a pair can
    qualify for more than one dormancy reason at once, and the order is a deliberate, tested precedence,
    not incidental:
    1. `"disabled"` — `AppConfig.gitRemoteCheck === "off"`. Checked before anything else, for the whole
       project in one shot, touching no `git` and no network at all: this is what makes ambiguity #3 true
       (a flipped-off project costs zero network I/O, not zero I/O whatsoever — `refsForProject` still does
       its one `loadWorkspaces()` read up front, before the mode is even consulted, since the ref set is
       needed either way to know which refs to label `"disabled"`).
    2. `"upstream-gone"` — a *prior completed* check found this ref absent from the remote. Checked right
       after `"disabled"` and ahead of the credential ladder proper, because it is a fact about the remote
       itself, not a credential/local-policy question — see "Design notes" for why it is deliberately
       **sticky until process restart** rather than re-verified on a timer.
    3. `"never-authenticated"` — rung 2 of the credential ladder proper (`isRemoteTrusted`) hasn't fired
       yet. Checked next because it's the cheapest real gate (one local JSON read) and, since this repo's
       trust record is write-once/monotonic (`noteRemoteTrusted`, never revoked), an untrusted pair can
       never simultaneously be "failing" — so in practice this and `"failing"` are mutually exclusive, but
       the order is still fixed and tested via the reachable case (untrusted beats a *configured-but-unused*
       ssh-agent-present condition, since trust is checked first and short-circuits before `remoteUrlKind`
       is ever called). (A direct "upstream-gone beats never-authenticated" precedence test isn't
       constructible with the real, monotonic `isRemoteTrusted` — reaching `"upstream-gone"` requires a
       prior *successful* check, which itself requires trust to already have passed. The order is still
       correct and load-bearing by code structure — see `policy.test.ts`'s upstream-gone-vs-ssh-agent-present
       test for the reachable sibling proof.)
    4. `"ssh-agent-present"` — rung 3 (`remoteUrlKind` is `"ssh"` and `sshAgentPresent()`). Checked after
       trust because it requires a `git` subprocess call (`remote get-url`) the untrusted case skips
       entirely.
    5. `"failing"` — this pair's per-pair backoff clock (below) hasn't elapsed yet. Checked last: it is
       the only reason that can *change on its own* between checks (the other rungs above it are
       configuration/trust/remote-fact state), and it's the only one that requires having attempted a real
       network call at least once.
    First reason that matches wins; `null` (not dormant) only when none do, which is also the one case
    that adds the pair to this round's network batch.
  - **Per-pair exponential backoff on failure, with quiet recovery**: `BACKOFF_BASE_MS` (5 minutes) on the
    first failure, doubling per *consecutive* failure, capped at `BACKOFF_MAX_MS` (24 hours) so a
    permanently broken remote is retried at most once a day rather than backing off forever and becoming
    undiagnosable. `nextRetryAt` gates future attempts (ladder step 4); a later success — probe or fetch,
    `ok: true` — clears `failureCount`/`nextRetryAt` and the `"failing"` label in the same round, silently
    (no toast per tick, matching the plan's "never nag" rule — this module has no toast concept at all, so
    that rule is satisfied structurally). A failed attempt never overwrites `behind`/`lastCheckedAt`: those
    fields reflect the last time a check *actually completed*, exactly as `RemoteState`'s own doc states.
  - **Turning a probe/fetch result into `RemoteState.behind`, honestly** — the comparison basis in every
    case is the *local* remote-tracking ref (`refs/remotes/origin/<name>`, read fresh via `git`'s exported
    `trackingRefOid` — see "Design notes" below for why this, not an in-memory "last observed" cache, is
    the correct anchor):
    - **probe mode, the remote's head differs from the local tracking ref** → `"unknown"`: we know it
      moved, never by how much, because `ls-remote` makes no object local.
    - **probe or fetch mode, they match** → `null` (up to date).
    - **fetch mode, the ref moved** (`fetchRemoteRefs`'s own `moved` list) → `behindFromDelta` reads the
      two-sided `refDelta(repoPath, <the tracking ref's oid from just before this fetch>,
      "refs/remotes/origin/<name>")`, because **"moved" does not mean "moved forward"** — an upstream can be
      force-pushed, and only `ahead === 0` proves the move was a fast-forward whose `behind` is an honest
      count:
      - `ahead === 0, behind > 0` — fast-forward → the exact count.
      - `ahead > 0, behind === 0` — a **rewind** (force-pushed backward onto a commit we already have) →
        `null`, up to date. There is genuinely nothing upstream we lack. A one-sided `from..to` count would
        have said `0` here, which the UI renders as "↓·0 … is 0 commits behind" — the "changed by nothing"
        lie `RemoteState`'s own contract calls out.
      - `ahead > 0, behind > 0` — **divergence** (an upstream rebase/amend) → `"unknown"`. Commits did land,
        but a bare "N behind" describes a fast-forward that never happened; the bare `↓` plus a fetch
        affordance is the honest rendering.
      If there is no *before* value (this pair's very first fetch — nothing to measure *from*) or `refDelta`
      itself returns `null` (a resolution failure) → `null` for the former (a fresh baseline, nothing to
      report yet) / `"unknown"` for the latter (a real range that failed to resolve). Never substituted with
      `0` or a guess in any of these cases.
    - A ref absent from a successful probe's result, or a name the classifying `ls-remote` below reports
      absent, means the upstream branch no longer exists: `{ behind: null, dormant: "upstream-gone" }` —
      **never** a bare `behind: null` with no reason, which a consumer rendering no dormant field at all
      would misread as "up to date". This is a real, completed finding, not a failure: it clears any live
      backoff exactly like a genuine up-to-date/moved result does.
  - **Fetch mode isolates a batch failure instead of attributing it to every requested ref.**
    `fetchRemoteRefsArgv` names every ref explicitly, so `git fetch origin <name…>` exits non-zero for the
    **whole** invocation the moment even one named ref no longer exists upstream — verified empirically —
    even when every other named ref is perfectly fetchable. Treating that as "every ref in the batch is
    now failing" would be wrong (and, worse, permanently wrong: a healthy sibling ref would stay falsely
    marked "failing" forever, since nothing else would ever re-attempt it once no ref in a poisoned batch
    is presumed fetchable). On a batch fetch failure, `applyFetch` recovers in two extra network calls at
    most, regardless of batch size:
    1. A classifying `probeRemoteRefs` (`ls-remote`) over the same names — this call, unlike `fetch`,
       never fails just because one requested name is absent, so it safely partitions the batch into
       `gone` (absent from the probe's heads) and `survivors` (present).
    2. If the classifying probe **itself** fails, the remote is genuinely unreachable (a transient/network
       failure) — every originally-requested name is marked `"failing"` via `markFailure`, never guessed
       `"upstream-gone"`. This is the case that must never be confused with the one above: an unreachable
       remote says nothing about which refs still exist.
    3. Otherwise, `gone` names are marked `"upstream-gone"` directly, and (if any survivors remain) the
       fetch is retried naming only the `survivors` — interpreted exactly like a batch that succeeded on
       the first attempt (`applyFetchOutcome`, shared by both paths).
  - **`remoteStateFor(projectId): RemoteState[]` is a pure cache READ — never a probe trigger.** It
    re-derives the current ref set (a `loadWorkspaces()` read — cheap, same pattern the mechanics half
    already uses for `loadProjects()`) and projects each ref's last-computed `PairRecord` (behind,
    lastCheckedAt, dormant) onto the wire shape. It never calls `git`, never calls `isRemoteTrusted`, and
    never blocks on a network call — all of that only ever happens inside `checkProject`, on schedule. A
    ref this project has derived but never yet had `checkProject` run for reports `{ behind: null,
    lastCheckedAt: null }` with no `dormant` field at all (not even `"disabled"` if the mode happens to be
    `"off"` right now) — an honest "not yet known", never a live-recomputed guess.
  - **`setRemoteStatePublisher(fn: ((payload: ProjectRemoteStatePayload) => void) | null)`** — the exact
    `setFsNudgePublisher`-shaped seam (`host/fsNudge.ts`): a module-level nullable function, `null` a
    silent no-op. `checkProject` calls it once per invocation with the *full* per-project snapshot (every
    derived ref, not just the ones this round's network batch touched), matching
    `ProjectRemoteStatePayload`'s replace-not-merge contract.
  - **The real `checkProject: CheckProjectFn`** this module hands to the mechanics half via the barrel —
    ties every bullet above together: derive refs → short-circuit on `"off"` → ladder each ref → batch the
    survivors into one `probeRemoteRefs`/`fetchRemoteRefs` call (one network round-trip per project per
    round, however many refs it covers, per `ProjectRemoteStatePayload`'s own doc) → apply the result →
    publish.
  - **Every remote call passes an explicit deadline**, `REMOTE_CHECK_TIMEOUT_MS` (15s) — generous for a
    healthy `ls-remote`/`fetch`, short enough that one stuck project doesn't stall a check round for long
    before the mechanics half's funnel moves on to the next trigger.
  - **All policy state (`PairRecord` — behind, lastCheckedAt, dormant, failureCount, nextRetryAt) is
    in-memory, per `(projectId, ref)`, and reset on process restart** — exactly as the mechanics half's own
    `projectStates` is. A restart re-attempting a currently-backed-off pair once is an acceptable cost;
    persisting backoff across restarts was not worth the complexity.
  - **Stale `PairRecord`s are pruned every round, before anything else** (`pruneStaleRecords`, called at
    the top of `checkProject` with the freshly-derived ref set): a ref no longer produced by any of a
    project's workspaces (re-pointed base, deleted workspace) has its record dropped rather than left to
    occupy memory for the rest of the process's life under ordinary workspace churn. A pruned ref that
    later reappears (e.g. a workspace re-pointed back) starts from a fresh record deliberately — nothing
    about its old backoff/dormancy state is still true once it was gone for a round.
  - **The git-function seam + the clock are injected**, mirroring `RemoteCheckDeps`: production defaults
    (the real `probeRemoteRefs`/`fetchRemoteRefs`/`refDelta`/`remoteUrlKind`/`sshAgentPresent`, plus
    `git/remoteRefs.ts`'s exported `trackingRefOid` — the same "what does this repo currently believe this
    tracking ref points at" primitive `fetchRemoteRefs` itself uses internally, reused here rather than
    reimplemented a third time, and `Date.now`) are installed directly at module scope, overridable only
    by this module's own test file (not barrel-exported) — so a policy test fakes git's *answers*, never
    git itself, and never sleeps for the backoff timing either.
- **`fetchRefNow(projectId, ref): Promise<RemoteState>`** — the policy half of `git.fetchNow`, a
  user-initiated real fetch of exactly one pair. Unlike `checkProject`, it **bypasses the credential ladder
  entirely**: it is the one path that performs a real git operation for a pair that has never been trusted
  (`isRemoteTrusted` would otherwise gate `checkProject` from ever calling git for it, forever — this is how
  rung 2 of the ladder gets satisfied in the first place). It reuses `applyFetch` (the same
  batch-then-classify-then-retry recovery `checkProject`'s fetch mode uses, degenerate here at a batch of
  one) so a vanished upstream branch resolves as `dormant: "upstream-gone"` rather than reintroducing the
  batch-poisoning bug class `applyFetch` already exists to prevent; folds the result into the same
  `PairRecord` `checkProject`/`remoteStateFor` read and write, and publishes the project's full snapshot.
  Throws (never resolves a `RemoteState`) on a non-remote-tracking `ref`, an unknown `projectId`, or a
  genuine fetch failure (`dormant: "failing"`) — recording the resulting trust (`noteRemoteTrusted`) is the
  **host's** job, called only after this resolves successfully, never this function's.
- **`noteRemoteTrusted(projectId, remote)`** is re-exported here (from `persistence`, which this module
  already depends on) purely so `host` can satisfy ladder rung 2 through this same barrel, without gaining
  a direct `persistence` edge of its own for that one call.
- **Public surface (barrel, policy half):** `checkProject` (the real implementation host wiring passes to
  `startRemoteChecks`), `fetchRefNow`, `noteRemoteTrusted` (re-exported), `remoteStateFor`,
  `setRemoteStatePublisher`, plus the `RemoteCheckPolicyDeps` type and
  `BACKOFF_BASE_MS`/`BACKOFF_MAX_MS`/`REMOTE_CHECK_TIMEOUT_MS`. The test-only
  `configureRemoteCheckPolicyDeps` setter is deliberately **not** barrel-exported (`policy.test.ts`
  imports it directly from `./policy`, exactly as `remotes.test.ts` imports `startRemoteChecks` directly
  from `./remotes` rather than through `./index`).
- **Allowed deps (policy half):** `git` (`probeRemoteRefs`, `fetchRemoteRefs`, `refDelta`,
  `remoteUrlKind`, `sshAgentPresent`, `diffBaseRef`, and `trackingRefOid` — for reading a local tracking
  ref's oid; see "Design notes"), `persistence` (`isRemoteTrusted`, `loadProjects`, `loadWorkspaces`,
  `noteRemoteTrusted`), `contracts` (`RemoteState`, `RemoteDormantReason`, `ProjectRemoteStatePayload`,
  `AppConfig`), and the mechanics half's own `currentGitRemoteCheckMode()` (a direct file import, not
  through the barrel — both files are this one module's internal organization, not a boundary).
- **Forbidden (both halves):** `host` (config and the publish seam are both injected, never read by
  importing `host`; `host` is the one that imports `remotes`, never the reverse); `settings` (see above —
  config arrives by injection only); sibling feature modules the policy half doesn't need (`workspaces`,
  `chats`, …) — note `fetchRefNow` takes a bare `(projectId, ref)`, never a `Workspace`, precisely so this
  module never needs a `workspaces` import to resolve one.

## Design notes (policy half)

- **Why the comparison basis is the local tracking ref, read fresh via `git`, and not an in-memory
  "last observed sha" cache**: an in-memory cache's first-ever comparison has nothing to compare against,
  so it would have to treat whatever the remote happens to be at on first sight as the new zero-point —
  silently hiding any staleness that already existed before the app ever started watching (e.g. the repo
  was cloned weeks ago and origin/main has moved a great deal since). Reading the actual on-disk
  `refs/remotes/origin/<name>` instead anchors every comparison — including the very first one, and every
  one after a process restart, when the in-memory cache would otherwise have reset — to real git state, not
  to this process's own memory of what it last happened to see.
- **Why fetch mode's exact count is `refDelta(repoPath, <tracking ref oid from just before the fetch>,
  "refs/remotes/origin/<name>")`, not `refDelta(repoPath, "HEAD", …)`**: `RemoteState` is tracked per
  `(project, ref)`, never per workspace, and a project can have several workspaces (worktrees) with
  different `HEAD`s. Counting from an arbitrary workspace's `HEAD` would make the reported count depend on
  which workspace happened to supply it — the exact per-workspace leakage this module exists to avoid.
  Counting from the ref's own prior value answers a workspace-agnostic question instead: "how many new
  commits did `origin/<name>` itself pick up since we last looked" — the same thing `fetchRemoteRefs`'s own
  `moved` detection already computes internally, just also expressed as a count.
- **A vanished upstream branch** (the requested ref is absent from an otherwise-successful probe result,
  or from the classifying `ls-remote` used to recover from a batch fetch failure) reports
  `{ behind: null, dormant: "upstream-gone" }`, never a bare `behind: null` with no reason — a bare `null`
  reads as "up to date" to a UI rendering no dormant field at all, which would misrepresent a branch that
  no longer exists as one that's simply current. `"upstream-gone"` is its own `RemoteDormantReason` rather
  than reusing `"unknown"` (which already means something different: "differs, but by an amount a probe
  can't know" — a live branch, not a dead one) specifically so a later UI can render the two cases apart.
- **Why `"upstream-gone"` is sticky until process restart, never re-verified on a timer**: once a
  completed check finds a ref absent from the remote, there is no cheap self-healing signal to re-check it
  against (branches that get deleted upstream do not typically come back), and re-probing it on every
  round forever would cost a real network round-trip for a pair that is, for all practical purposes, dead.
  This matches the module's existing precedent that in-memory policy state resets only on restart, never
  on its own; a restart re-attempting a currently-`"upstream-gone"` pair once, and discovering it really is
  still gone, is an acceptable cost — identical in kind to the accepted cost of re-attempting a
  currently-backed-off `"failing"` pair once after a restart.
- **Why a batch fetch failure is isolated (classify, then retry survivors) rather than attributed to every
  requested ref**: `fetchRemoteRefsArgv` names every ref explicitly, and `git fetch origin <name…>` exits
  non-zero for the *entire* invocation the moment even one named ref no longer exists upstream — verified
  empirically, by running exactly that fetch against a remote with one healthy and one deleted branch and
  observing the healthy branch is never fetched even though the command's own exit code gives no way to
  tell that apart from "nothing in the batch worked" without a follow-up call. A per-ref fetch loop would
  also work but costs one network round-trip per ref every round, defeating the whole point of batching;
  a classifying `ls-remote` (which does not share `fetch`'s all-or-nothing failure mode — it simply omits
  a head it can't find) plus a survivors-only retry costs at most two extra round-trips *total*,
  regardless of batch size, and only on the failure path at all. The classifying probe's own failure is
  the deliberate fallback to "genuinely unreachable, mark everything failing" — it must never be read as
  "everything is gone", since an unreachable remote answers nothing about which refs still exist.

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
- **`remoteStateFor` must stay a pure cache read, forever** — the temptation to make it "more live" by
  recomputing dormancy or re-probing on a read is exactly the "probe trigger disguised as a read" this
  module's design deliberately avoids; any richer read still belongs behind `checkProject`, on schedule.
- **A failed attempt never touches `behind`/`lastCheckedAt`** — only `failureCount`/`nextRetryAt`/
  `dormant`. Those two fields are a promise about the *last completed* check, and a failure completed
  nothing new to report.
- **The dormancy ladder's order is load-bearing, not cosmetic** — `disabled` → `upstream-gone` →
  `never-authenticated` → `ssh-agent-present` → `failing`. Tested directly (see `policy.test.ts`), because
  a pair reaching this ladder can satisfy more than one rung's condition at once and the precedence must
  be deterministic.
- **A batch fetch failure must never be attributed to every requested ref without isolating first** — the
  fast path (one `fetch` call for the whole batch) stays the fast path; a failure triggers a classifying
  `ls-remote` before anything is marked `"upstream-gone"` OR `"failing"`, and a failure of *that* probe
  too is what proves the remote itself is unreachable (never a signal that every ref is gone).
