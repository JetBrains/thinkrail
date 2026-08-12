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
not already done so.

Provider-backed browser tests (`e2e:agent`) and the separate headless workflow suite are not parallelized by
this runner: concurrent provider turns would alter rate limits, cost, and determinism. The compiled-binary
suite remains a distinct artifact gate. Its unsharded namespace does not overlap adaptive lanes, but a
binary run and `e2e:serial` still run sequentially in the same worktree.

## Isolation contract

Every concurrent lane derives a distinct data dir, HOME, pi-agent dir, fixture repository, binary cache,
restart artifacts, picker/editor/provider control files, host/restart/binary ports, and JetBrains proxy
port. Port allocation remains stable and collision-safe across worktrees: the registry claim distinguishes
a lane's logical key while checking staleness against the real worktree path. Legacy plain-path claims are
still valid.

Different worktrees may run concurrently. Two complete E2E invocations in one worktree remain sequential;
the lane ids are deliberately stable across runs so interrupted state is reclaimed rather than leaked.
No path may fall back to `~/.thinkrail`, the developer's HOME/config trees, or the real pi agent dir.

## Boundary

- **Owns:** browser scenarios and fixtures under `e2e/`, their Playwright configuration/runner entrypoints,
  isolation and port-allocation rules, report orchestration, and the public `e2e*` package commands.
- **Consumes:** the built web artifact, the host's public boot/wire behavior, sanctioned server test-fixture
  exports, git, Chromium, and Playwright.
- **Forbidden:** fake application backends, provider fakes in production boot paths, browser imports into
  product modules, tests depending on developer state, or parallel workers sharing one mutable host.

## Verification policy

During iteration, run the affected specs and use Playwright's last-failed mode. Before handoff, every
app-affecting change runs the complete `bun run e2e` no-agent gate. Binary-only regressions remain covered by
`e2e:binary`; real agent behavior remains covered by explicitly selected `@agent` suites rather than a fake
agent.
