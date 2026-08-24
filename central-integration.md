---
id: central-integration
type: architecture-design
status: active
title: JetBrains AI via the Central CLI — cross-module lifecycle
parent: architecture
depends-on: [module-shared, submodule-server-auth, submodule-server-agent, module-contracts, submodule-web-panels]
covers: [central-lifecycle, central-liveness, central-trust-boundary, central-artifact]
tags: [v1, providers, central]
---

## Drivers

JetBrains AI models reach ThinkRail through the user's own `central` CLI, which writes a `pi` extension to
one global path. That makes Central's behaviour a **chain across five modules** rather than a module
boundary, and two of its properties live only in the chain: the end-to-end state mapping and its liveness.

**Boundary: this node owns the composition and nothing else.** Each module's spec stays authoritative for
its own surface and is not restated here — the adapter's argv/version/parse contract is
[[module-shared]], status and action orchestration is [[submodule-server-auth]], runtime generations are
[[submodule-server-agent]], wire shapes are [[module-contracts]], the card's rendering is
[[submodule-web-panels]]. A change that only affects one surface updates that leaf, not this file.

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

Two facts the table encodes that no single module states:

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

The adapter's argv set, version policy, status-row parsing, login grace and process timeouts; the card's
interaction and copy; candidate preparation and generation activation; wire field shapes; boot ordering;
e2e fixtures. Each stays in its own module spec — listed here only so a reader knows this file is not where
to change them.

## Consumed by

[[module-shared]] · [[submodule-server-auth]] · [[submodule-server-agent]] · [[module-contracts]] ·
[[submodule-web-panels]] · [[module-cli]] (boot ordering) · [[module-browser-e2e]] (`00-jbcentral*`)
