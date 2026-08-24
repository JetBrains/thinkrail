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

1. **One artifact is the whole coupling.** `~/.pi/agent/extensions/jetbrains-central.ts`, named identically
   by the adapter that watches it and the `pi` runtime that loads it. `central add pi` creates it,
   `central remove pi` deletes it, and existence *is* the configured verdict. ThinkRail never opens, parses,
   hashes, or copies it. Corollary that makes the first invariant subtle: because existence is the only fact
   read, an **in-place replacement is invisible to an existence check**, so the watcher — not the poll — is
   the only thing that can observe one.
2. **No Central-derived text ever reaches a client.** Every state above is a closed enum the host chose,
   never a passthrough of what Central printed. The obligation is enforced in three places, each
   authoritative for its own half: the process surface invokes only reviewed argv and maps only exit success
   plus a safe postcondition to an outcome ([[module-shared]]); the runtime surface receives the artifact
   path as the only artifact fact and captures the provider-id allowlist *before* the opaque extension loads
   ([[submodule-server-agent]]); the wire surface never lets Central-owned providers, credentials, or details
   become ordinary provider rows ([[submodule-server-auth]], [[module-contracts]]).

## Invariants

1. **Invalidation is edge-triggered on the artifact, never level-triggered on a directory.** `fs.watch` is
   per-directory and the watcher re-arms from the nearest existing parent, so the watched directory is
   routinely an *ancestor* — with Central never installed it is `~/.pi/agent`, `pi`'s entire state directory.
   Forwarding raw directory events therefore converts unrelated `pi` churn into rebuild demand. Held by
   [[module-shared]].
2. **Every path into `configuring` has a bounded exit.** Two paths reach it: an in-flight action (bounded by
   the adapter's `ACTION_TIMEOUT_MS` / `UPDATE_TIMEOUT_MS`) and an outstanding rebuild
   (`settledSequence < requestedSequence`). A path with no bound is a stuck card, not a slow one, because
   the state carries no deadline of its own.
3. **The rebuild drain settles a requested sequence in bounded time, independent of inbound event rate.**
   A debounce cannot supply this: it bounds *burst width*, not stream length, so an unbounded event source
   starves any drain that restarts on every new sequence.

**Invariant 3 is currently violated.** `runRebuildDrain` re-reads `requestedSequence` after each
`preparePiRuntimeGeneration()` and discards the completed build when it changed, so progress requires a
quiet window of the debounce plus a full runtime build, and nothing bounds how many times it may discard.
Worse, the activation sits after that guard, so under starvation no generation is adopted at all and the
host serves the boot-time runtime indefinitely. Latent, not fixed: invariant 1 removed the only known event
source fast enough to trigger it, and a second such source reproduces it unchanged.

**Post-mortem.** Both halves of the composition were individually correct. [[module-shared]] said the
caller debounces events and rechecks existence; [[submodule-server-auth]] said watcher drift schedules a
rebuild and status is `configuring` until the newest candidate applies. Composed against an endless event
stream — `pi` rewriting `auth.json.lock` and `models-store.json` at ~23 events/s while idle — the drain
never settled, `getJbcentralStatus()` pinned `configuring`, and users with no Central installed were told
ThinkRail "is applying the latest Central configuration" while the host rebuilt the `pi` runtime in a hot
loop at ~30-45% CPU. No spec was wrong; no spec owned the composition.

## Out of scope

The adapter's argv set, version policy, status-row parsing, login grace and process timeouts; the card's
interaction and copy; candidate preparation and generation activation; wire field shapes; boot ordering;
e2e fixtures. Each stays in its own module spec — listed here only so a reader knows this file is not where
to change them.

## Consumed by

[[module-shared]] · [[submodule-server-auth]] · [[submodule-server-agent]] · [[module-contracts]] ·
[[submodule-web-panels]] · [[module-cli]] (boot ordering) · [[module-browser-e2e]] (`00-jbcentral*`)
