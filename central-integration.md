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

## Why this node exists

Every other Central concern is already owned by the module that implements it: the process/filesystem
adapter in [[module-shared]], the status/action orchestration in [[submodule-server-auth]], runtime
generations in [[submodule-server-agent]], the wire shapes in [[module-contracts]], the card in
[[submodule-web-panels]]. Those specs are correct and stay authoritative for their own surfaces; this
node **does not restate them**.

What no module can own is the **composition**. Central is the only integration where ThinkRail shells out
to a third-party binary that writes into `pi`'s own state directory and injects an opaque extension into a
live runtime, so its behaviour is a chain across five modules. Two properties live only in that chain:
the state mapping end to end (§1) and its **liveness** (§2). Both were unowned, and a beta shipped a
permanent-`configuring` livelock as a direct result — see §2.

## §1 The chain

The single end-to-end mapping. Each column is owned by the module named in its header; this table is the
only place the *correspondence* is stated.

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

## §2 Liveness

The chain is a state machine that must always make progress. Three invariants, in dependency order:

1. **Invalidation is edge-triggered on the artifact, never level-triggered on a directory.**
   `fs.watch` is per-directory and the watcher re-arms from the nearest existing parent, so the watched
   directory is routinely an *ancestor* — with Central never installed it is `~/.pi/agent`, `pi`'s entire
   state directory. Forwarding raw directory events therefore converts unrelated `pi` churn into rebuild
   demand. Owned by [[module-shared]].
2. **Every path into `configuring` has a bounded exit.** Two paths reach it today: an in-flight action
   (bounded by the adapter's `ACTION_TIMEOUT_MS` / `UPDATE_TIMEOUT_MS`) and an outstanding rebuild
   (`settledSequence < requestedSequence`). A path with no bound is a stuck card, not a slow one, because
   the state carries no deadline of its own.
3. **The rebuild drain settles a requested sequence in bounded time, independent of inbound event rate.**
   Debouncing in the caller cannot supply this: a debounce bounds *burst* width, not stream length, so an
   unbounded event source starves any drain that restarts on every new sequence.

**Known violation of #3.** `runRebuildDrain` re-reads `requestedSequence` after each
`preparePiRuntimeGeneration()` and restarts when it changed, so any event source faster than one rebuild
starves it indefinitely. This is currently latent rather than live: #1 removed the only known source fast
enough to trigger it. It is recorded here as a violated invariant, not a resolved one — a second such
source reproduces the livelock without any change to #1.

**Post-mortem (the beta livelock).** Both halves of the composition were individually correct.
[[module-shared]] said the caller debounces events and rechecks existence; [[submodule-server-auth]] said
watcher drift schedules a rebuild and status is `configuring` until the newest candidate applies. Composed
against an endless event stream — `pi` rewriting `auth.json.lock` and `models-store.json` at ~23 events/s
while idle — the drain never settled, `getJbcentralStatus()` pinned `configuring`, and users with no
Central installed were told ThinkRail "is applying the latest Central configuration" while the host
rebuilt the `pi` runtime in a hot loop at ~30-45% CPU. No spec was wrong; no spec owned the composition.
That is the gap this node closes.

## §3 Trust boundary

Central is **opaque**: a third-party binary and a generated extension, neither of which ThinkRail reads.
The obligations are enforced in three modules and only summarised here — each module's spec is
authoritative for its own half.

- **Process surface** ([[module-shared]]) — only reviewed argv is invoked; no child output is logged or
  returned; only exit success plus a safe postcondition maps to a closed outcome. `central status`
  presentation rows are the sole exception, and even there only positively observed negatives escape.
- **Runtime surface** ([[submodule-server-agent]]) — the artifact path is the only artifact fact the module
  receives; the pre-opaque provider-id allowlist is captured *before* the extension loads.
- **Wire surface** ([[submodule-server-auth]], [[module-contracts]]) — Central-owned provider objects,
  credentials, and details never become ordinary provider rows or cross the wire; Central is represented
  only by the dedicated closed lifecycle, never inferred from model URLs.

The composed guarantee: **no Central-derived text ever reaches a client.** Every state in §1 is a closed
enum the host chose, never a passthrough of what Central printed.

## §4 Artifact contract

One path, `~/.pi/agent/extensions/jetbrains-central.ts`, named identically by the adapter that watches it
and by the `pi` runtime that loads it. This is the whole coupling between ThinkRail and Central's output —
`central add pi` creates it, `central remove pi` deletes it, and existence *is* the configured verdict.

ThinkRail never opens, parses, hashes, or copies it. The corollary that makes §2.1 subtle: because
existence is the only fact read, an **in-place replacement** is invisible to an existence check, so the
watcher — not the poll — is the only thing that can observe it.

## Consumed by

[[module-shared]] · [[submodule-server-auth]] · [[submodule-server-agent]] · [[module-contracts]] ·
[[submodule-web-panels]] · [[module-cli]] (boot ordering) · [[module-browser-e2e]] (`00-jbcentral*`)
