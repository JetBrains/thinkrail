---
id: submodule-pi-dag-domain
type: submodule-design
status: active
title: DAG contracts and pure domain rules
parent: module-pi-dag
tags: [backend, dag]
---

## Responsibility

Own typed graph/command schemas, public DTOs, persisted domain evidence and pure graph validation,
readiness, stale propagation and authorization. Graph/command and persisted-record types are inferred
from their validation schemas; public read projections stay distinct. Persisted records distinguish
versions, attempts, activations, proposals and gates. Delegation birth metadata is checked against the
same stored birth schema before entering state; the broader delegation contract is not duplicated.

## Boundary

The barrel exposes contracts, schemas, validation/error helpers and pure graph/state operations to
package siblings. Allowed external dependencies are typebox and type-only public pi/delegation types.
Forbidden: filesystem, provider/session instantiation, transport, runtime or persistence imports.
The parent spec owns sibling dependency edges. Public package exports select client contracts; private
persisted state is not automatically published through the package barrel.

## Invariants

Validate the full graph before commit: safe unique ids, acyclic connections, declared compatible
ports with exactly one producer, one explicit fork base, and no skipped fork source. Required inputs
need producers. Readiness consumes accepted, current, authorized evidence, not terminal status alone.
Affected descendants include waiting/paused work. Authorization is trusted binding provenance;
owner callbacks are not human approvals. Cancellation does not decide a gate: unresolved current-attempt
gates still protect skip and dependency edits, even when their execution was cancelled. Explicit retry
supersedes that attempt but preserves the node's release/input policy. Omitted `inputAuthority`
means human-only, even before the first input gate: weakening that policy or removing the node
requires human provenance, just like an explicit human-only policy.
Revisions never erase prior evidence. Edit preparation computes the validated graph, affected nodes
and required authority once; the runtime reuses that result only if the acquired state still has the
prepared version and matches the caller's expected version. This includes authority stamped on the
replay receipt: an ownership handoff cannot reuse authorization from an older snapshot.
Pending continuations store only their payload. Decoding still accepts the obsolete optional
`sourceActivation` field so previously saved continuations remain readable; it has no control authority.
