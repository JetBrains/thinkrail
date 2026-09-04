---
id: central-integration
type: architecture-design
status: active
title: JetBrains AI via the Central CLI — cross-module lifecycle
parent: architecture
depends-on: [module-shared, submodule-server-auth, submodule-server-agent, module-contracts, submodule-web-panels, submodule-server-settings, submodule-web-shell, submodule-web-store]
covers: [central-lifecycle, central-liveness, central-trust-boundary, central-artifact, central-quota]
tags: [v1, providers, central]
---

## Drivers

JetBrains AI models reach ThinkRail through the user's own `central` CLI, which writes a `pi` extension to
one global path and reports the account's recurring AI-credit quota. Central therefore behaves as a
cross-module chain rather than one module boundary. Its end-to-end lifecycle mapping, liveness, and
quota-read composition live only in that chain.

**Boundary: this node owns the composition and nothing else.** Each module's spec stays authoritative for
its own surface and is not restated here — the adapter's argv/version/quota-parse contract is
[[module-shared]], status/action/quota orchestration is [[submodule-server-auth]], runtime generations are
[[submodule-server-agent]], synchronized quota preferences are [[submodule-server-settings]], wire shapes
are [[module-contracts]], provider controls are [[submodule-web-panels]], and the global readout is
[[submodule-web-shell]]. A change that only affects one surface updates that leaf, not this file.

## The chain

The single end-to-end mapping. Each column is owned by the module in its header; this table is the only
place the *correspondence* between them is stated.

| Disk / CLI truth | `inspectJbcentral` (`shared`) | wire `JbcentralStatus` (`contracts`) | Card (`panels`) |
| --- | --- | --- | --- |
| no `central` resolvable | `absent` | `absent` | host-OS install command + Recheck |
| version below `MINIMUM_CENTRAL_VERSION` | `outdated` | `outdated` | guided Update |
| `--version` unparseable | `malformed-version` | `malformed-version` | reinstall guidance, no native action |
| probe launch/timeout/exit failure | `probe-failed` | `probe-failed` | recheck guidance |
| binary present, artifact absent | `supported` | `supported` | Connect |
| binary + artifact present | `supported` + `configured` | `configured` | Connected / Disconnect |
| …with `Auth` row `not connected` | — (observation) | `signedOut` flag | Sign in *replaces* the primary action |
| …with `Proxy` row stopped | — (observation) | `proxyStopped` flag | Start proxy *replaces* Disconnect |
| rebuild outstanding or action in flight | — | `configuring` | spinner, no action offered |
| candidate runtime failed to load | — | `load-failed` | Retry / Disconnect |

### Quota chain

When quota display is enabled, the visible web shell requests a closed quota snapshot on the configured
`1–3600` second cadence (30 seconds by default). The host first applies the synchronized setting and the
same healthy-Central predicate the provider card labels Connected, then server `auth` deduplicates readers
through one memory-only cache/single-flight and asks `shared` to run the absolute binary as
`central quota --json`. `shared` admits only recurring `remaining` + `total` numbers; `contracts` carries
only hidden/available/stale/unavailable states; `shell` renders them immediately left of host connection
status. Hidden frontends do not poll, disabled/unhealthy state performs no quota read, and no quota value is
persisted. A lifecycle edge clears the last successful fallback so a later account cannot inherit stale
numbers from the earlier one.

Two facts the lifecycle table encodes that no single module states:

- **`configuring` and `load-failed` have no inspection counterpart.** They are properties of the host's
  rebuild machinery, not of the host filesystem, so a reader following only `shared` cannot derive them.
- **The signed-out and proxy-stopped flags are one-directional.** Only a positively observed negative sets
  them; unknown never does. The card turns each into a *replacement* of the primary action rather than an
  annotation, because it must never advertise an action that cannot succeed.

## Decisions

1. **One reviewed artifact joins inspection to runtime loading.** The adapter owns its location, existence
   verdict, and watcher; the runtime receives only its opaque path. Because configured truth uses existence
   alone, in-place replacement depends on the watcher rather than the existence poll. The local mechanics
   remain authoritative in [[module-shared]] and [[submodule-server-agent]].
2. **No Central-derived text reaches a client.** The process adapter, pre-extension provider allowlist, and
   closed wire status each enforce one part of that guarantee; their local contracts remain in
   [[module-shared]], [[submodule-server-agent]], [[submodule-server-auth]], and [[module-contracts]].
   Quota extends the rule with a structured numeric allowlist: account, plan, usage, top-up, refill,
   diagnostics, and raw output remain host-local and are discarded.
3. **Quota is a separate read, not provider status and not a host ticker.** Provider lifecycle and quota have
   different latency/failure semantics, while a host-owned timer would run without a visible consumer.
   Visible clients own cadence; one host cache/single-flight prevents them multiplying CLI work.

## Invariants

1. **Watcher invalidations represent possible edges on the reviewed artifact, not directory activity.** The
   platform event classification and replacement-recovery mechanics belong only to [[module-shared]].
2. **Every path into `configuring` has a bounded exit.** Actions are bounded by adapter timeouts; an
   outstanding rebuild exits when the drain settles. The wire state carries no deadline of its own.
3. **The rebuild drain settles requested state in bounded time, independent of inbound event rate.** A
   debounce bounds burst width, not stream length, so it cannot provide this guarantee.

**Invariant 3 is currently violated and tracked by issue #287.** `runRebuildDrain` discards a completed
candidate whenever `requestedSequence` changed during preparation, so progress still requires a quiet
window and activation can starve indefinitely. Artifact-scoped invalidation removes the known source of
unrelated events but does not change that algorithm.

**Post-mortem.** With the artifact directory absent, the watcher fell back to `pi`'s state directory and
turned unrelated state writes into rebuild requests. The drain's quiet-window assumption kept
`configuring` active while repeatedly preparing runtimes. Each leaf contract was locally consistent, but
no spec owned their liveness in composition.

## Out of scope

The adapter's exact argv/schema/timeouts; provider-card and top-bar interaction/copy; settings validation;
candidate preparation and generation activation; wire field shapes; boot ordering; e2e fixtures. Each stays
in its own module spec — listed here only so a reader knows this file is not where to change them.

## Consumed by

[[module-shared]] · [[submodule-server-auth]] · [[submodule-server-agent]] ·
[[submodule-server-settings]] · [[module-contracts]] · [[submodule-web-store]] ·
[[submodule-web-panels]] · [[submodule-web-shell]] · [[module-cli]] (boot ordering) ·
[[module-browser-e2e]] (`00-jbcentral*`)
