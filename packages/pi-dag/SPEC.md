---
id: module-pi-dag
type: module-design
status: active
title: pi-dag — durable DAG contracts and storage
parent: architecture
depends-on: [module-pi-delegation]
tags: [dag, backend]
---

## Responsibility

Portable DAG definitions, controller/evidence contracts, pure validation and durable storage over
[[module-pi-delegation]] types. This foundation stores graphs and captured evidence without starting
pi sessions. It is not bundled into ThinkRail and is not yet a loadable pi extension. Runtime service
construction and pi tool registration are separate layers; their command/read contracts are defined
here without a placeholder scheduler or alternate state owner.

## Boundary

The package root exposes typed command/read/binding contracts and `LIMITS`. Internal module barrels
expose domain validation/state operations and `createDagStore`, `DagStore`, `DagLease` to package
siblings. The implemented dependency edge is `persistence → domain`.

Allowed external dependencies are public pi/delegation types, typebox and Node APIs. Forbidden:
ThinkRail/server/UI packages, pi-subagents policy, pi private fields, sibling internals, provider
invocation and session assembly. Pi-delegation remains the sole child/session execution owner.

## Contracts

Graphs have one acyclic data/control connection set and explicit history inheritance with at most
one fork base per destination. Edits validate atomically; human release/input policy cannot be
weakened by controller provenance. Persisted evidence separates versions, attempts, activations,
proposals, gates, immutable captured files and authorized receipts. Reads and serialization validate
identity and references rather than accepting partial or unknown snapshots.

Storage uses exclusive process ownership, monotonic snapshot CAS and immutable digest-addressed
payloads. Only proven-dead owners may be reclaimed. Atomic publication distinguishes definite
failure from post-rename ambiguity; reads do not acquire execution ownership. Relative artifact
identities survive relocation. Full invariants and failure semantics live in the domain and
persistence specs rather than being duplicated here.

## Verification

Provider-free public-module tests cover graph validation, policy and evidence integrity, real
filesystem publication, captured bytes, containment, competing processes, conservative dead-owner
recovery and ambiguous commits. No host integration, credentials or model requests are required.
