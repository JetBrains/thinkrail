---
id: module-browser-e2e
type: module-design
status: active
title: Browser E2E harness
parent: architecture
depends-on: [module-server, module-web, module-cli]
references: [module-ci-release]
tags: [testing, playwright, e2e]
---

## Responsibility

The real-browser system gate for ThinkRail's host/UI integration: build the shipped web client, boot an
isolated host, seed real git and persistence fixtures, drive Chromium through the wire, and clean up every
machine-global resource it used. The default suite excludes provider-backed `@agent` tests; those remain
explicit, authenticated, on-demand runs.

## Execution model

`bun run e2e` is the complete no-agent gate. It builds the web bundle once and runs machine-adaptive,
process-level Playwright shards. A shard owns one host and one Playwright worker; serial execution inside
that lane preserves the suite's destructive reset semantics, while lane-qualified state and ports make
lanes independent. Playwright splits individual tests across lanes and the parent runner merges their blob
reports into one normal result. It also merges shard failure ids into Playwright's root last-run file,
so `--last-failed` remains a valid serial repair loop. No-agent coverage is identical whether the count
is one or many.

The automatic count is half the available CPU parallelism, clamped to 1–8. Developers may explicitly
select 1–16 lanes; `e2e:serial` is the stable debugging fallback. A focused invocation carrying Playwright
arguments defaults to one lane unless its shard count is explicit, so an iteration on one spec stays cheap.
Direct use of the Playwright config remains self-contained and builds the web app when the shard runner has
not already done so. Tests for primary-modifier chords read the page's browser-reported platform through one
fixture helper and inject Meta on Apple or Control elsewhere; hard-coding the runner host's modifier would
exercise the wrong product branch under browser/platform emulation.

Provider-backed browser tests (`e2e:agent`) and the separate headless workflow suite are not parallelized by
this runner: concurrent provider turns would alter rate limits, cost, and determinism. The compiled-binary
suite remains a distinct artifact gate. Its unsharded namespace does not overlap adaptive lanes, but a
binary run and `e2e:serial` still run sequentially in the same worktree.

JetBrains Central coverage uses a stateful, independently authored fake executable implementing only the
argv/exit/postcondition surface ThinkRail invokes (`--version`, `status`, `add pi`, `remove pi`, `login`,
`update --install`). Its control file holds **space-separated tokens**, because the version a probe reports,
whether credentials exist, and how an action fails are independent facts about a host: a single-valued control
made real combinations unrepresentable, and a state that cannot be reached is a failure mode nothing asserts
(`update --install` refusing while the host is below the minimum needs both at once). It
materializes a test-owned synthetic PI extension written solely against PI's public API; no Central artifact,
source fragment, output string, route, constant, binary, or secret is copied. Browser scenarios cover
absent/outdated/malformed probes plus an above-minimum version staying ready, update, sign-in/retry, native
add/remove, synchronous-action
serialization, watched external add/change/remove, successful current-generation cutover for new chats, old
live-chat coexistence after Disconnect, and boot/runtime retention after a closed synthetic-extension load
failure. Unit coverage owns action single-flight, watcher debounce/coalescing, stale-candidate rejection, boot
with and without the opaque extension, and exact-model no-fallback for new or reattached chats after Central
is removed. There is no legacy migration, busy-turn drain, reattachment of live chats, compensation,
affected-chat blocking, or recovery seal to test. Sentinel values in synthetic child output, extension
diagnostics, and provider routing fields
are asserted absent from the closed results and rendered settings surface; structural DTO allowlists and
generic host mapping keep those classes out of WS frames, analytics, logs, and persistence.

The Central specs share one fixture module for panel navigation, lifecycle-state waits, the argv log, and
the out-of-band host mutations — installing/uninstalling the fake by moving it in and out of the lane's PATH
directory, and running it directly as a user's own shell would. A host-side invocation deliberately inherits
none of the host's PATH, so a spec can never reach a real `central`. Because that same log records both
sides, a spec that injects a host invocation asserts *counts* rather than mere presence — that is what
distinguishes "the app reacted to an external change" from "the app re-ran the action".

A second spec covers the lifecycle a user actually walks, one test per situation: Central absent, installed
but signed out, uninstalled while connected, PI disconnected in-app and again on the host, and a host-side
logout. Its load-bearing assertions are the ones a state name cannot express — that an uninstall withdraws
Central's models from new chats while the global artifact survives, so reinstalling repairs by re-probing
instead of a second `add pi`; that a signed-out host is offered Sign in and **no Connect at all**, with the
ready claim replaced rather than annotated; and that a logout leaves the connection intact underneath while the
card renders one state only: the signed-out line without the contradicting "Connected" one, a single Sign in
with Disconnect withheld as well, and both restored once the user signs back in. The reactive guidance keeps
its own spec, driven by the case the probe cannot see: credentials present, `add pi` refused anyway.

The fake models the `Auth` row's shape only — a styled indicator, a padded label, a styled value — and prints
a sentinel line beside it that must never surface in the UI, since the real command prints the user's licence
and server. The cached verdict shapes the suite twice, and both accommodations are deliberately the same
thing a *user* does rather than a reach into the host. A spec that flips the host's credential state waits
the TTL out and refreshes, so the assertion belongs to the card's copy and not to the cache. And because
Connect is withheld while the verdict says signed out, every connect-driven scenario refreshes until the
button appears instead of assuming it — a verdict left behind by an earlier scenario would otherwise hide it,
exactly as it would for someone returning to the panel inside the window. Each state is also captured as a
review PNG under `e2e/screenshots/<group>/`
(gitignored, stable path, one element shot per state, retina). Screenshots are evidence, never the
assertion — a state that only a picture would catch is a missing `data-testid`. Identical files across
scenarios are a finding, not a defect: they are how the suite shows two distinct host situations rendering
one indistinguishable card.

## Isolation contract

Every concurrent lane derives a distinct data dir, HOME, pi-agent dir, fixture repository, binary cache,
restart artifacts, picker/editor/provider control files, host/restart/binary ports, and Central fixture
artifacts. Port allocation remains stable and collision-safe across worktrees: the registry claim distinguishes
a lane's logical key while checking staleness against the real worktree path. Legacy plain-path claims are
still valid.

Different worktrees may run concurrently. Two complete E2E invocations in one worktree remain sequential;
the lane ids are deliberately stable across runs so interrupted state is reclaimed rather than leaked.
No path may fall back to `~/.thinkrail`, the developer's HOME/config trees, or the real pi agent dir. A
sandboxed home is handed to the host as **both `HOME` and `USERPROFILE`**: `homedir()` — pi's own home
resolution — reads `USERPROFILE` on Windows and ignores `HOME`, so `HOME` alone would silently leak a
Windows lane into the real profile (see `module-shared`).

## Boundary

- **Owns:** browser scenarios and fixtures under `e2e/`, their Playwright configuration/runner entrypoints,
  isolation and port-allocation rules, report orchestration, and the public `e2e*` package commands.
- **Consumes:** the built web artifact, the host's public boot/wire behavior, sanctioned server test-fixture
  exports, git, Chromium, and Playwright.
- **Forbidden:** fake application backends, provider fakes in production boot paths, browser imports into
  product modules, tests depending on developer state, or parallel workers sharing one mutable host.

## Verification policy

During iteration, run the affected specs and use Playwright's last-failed mode. Flake repairs replace
irrelevant expensive setup with equivalent fixture state and wait for observable readiness; blanket retries,
arbitrary sleeps, and assertion weakening are not synchronization policy. Before handoff, every app-affecting
change runs the complete `bun run e2e` no-agent gate. Binary-only regressions remain covered by
`e2e:binary`: a synthetic opaque external extension loads in the compiled single-file host with no `pi`
executable on `PATH`, for default and custom `PI_CODING_AGENT_DIR`. Real Central acceptance remains
authorized and external; real agent behavior remains covered by explicitly selected `@agent` suites rather
than a fake agent.
