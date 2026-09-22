---
id: submodule-pi-dag-runtime
type: submodule-design
title: DAG command and execution owner
status: active
parent: module-pi-dag
---

# Runtime

## Boundary

Owns authorization, serialized per-DAG transitions, durable intent/effect/observation ordering,
admission, worker protocol, gates, interventions, recovery and passive notices. The public surface
is `createDagService`, `DagServiceOptions`. The service owns execution; bindings own authority and delivery only.
Internal files are one module, not independent schedulers. External dependencies are public pi,
pi-delegation and Node APIs. No host, UI, subagent policy or pi private implementation imports.
The parent SPEC declares sibling edges.

## State and effects

One queue serializes state changes per DAG. Only successful storage commits replace its in-memory
snapshot. A preparation intent freezes inputs/configuration before child assembly; the actual
materialized payload and immutable child birth are committed before `runQueued`. A retained job
connects controls to that invocation, never a future run. The scheduler bounds concurrent assembly
and uses delegation's run admission/settlement. It never starts another provider loop.

Settlement observes the actual outcome, retains exact history boundaries, captures export evidence
when needed and evaluates positive acceptance. Preparation failures have separate captured evidence,
not fabricated pi outcomes. Terminal commentary/error text beyond the captured-body quota is omitted
with explicit captured diagnostic evidence, never silently truncated; actual status, statistics and
history boundary remain durable. This does not invalidate a separately captured declared result.
The latest attempt retains its narrow child handle for continuation;
this also preserves a fresh session interrupted before pi has written its first assistant entry.
Retry and invalidation retire old handles outside the state queue. Recovery faithfully reopens saved
births; missing transcripts never cause replacement sessions. Outstanding jobs finish outside the
state queue. If an interrupted activation has no finalized assistant evidence, its frozen payload
is included in continuation: pi may not have appended the original user message during preflight.
An already queued answer is preserved, with optional continuation instructions appended rather than
silently replacing the answer. Continuation revalidates captured artifacts and appends their fresh
path hints, without changing their identities/bytes or rewriting historical prompts. This keeps
relocated captured storage usable while ordinary text/JSON inputs remain in the existing conversation.

Worker protocol receipts bind the current assistant entry plus tool-call id; inherited or earlier
provider ids are not invocation identity. Capture the active job before asynchronous queueing and
recheck that exact job before commit. Worker tools reject mixed assistant batches before persistence. Their callbacks identify the actual
session and activation, not model-supplied identities. Invocation receipts prevent repeat capture of
changed workspace files under a retried tool call. Artifact paths are opened nonblocking and checked
through the descriptor before reading, so special files cannot hold the serialized command queue. A later sole-batch proposal within the same active
pi invocation supersedes its predecessor; queued steering/recovery can continue pi after a protocol
result requests termination. An input gate cannot be replaced this way: answering it requires the
configured authority. Large submitted bodies and error details are files;
current snapshots and history carry bounded summaries and metadata. History/notice entries record
admission decisions, rejected execution, uncertainty, interventions and releases, without provider
credentials or a second telemetry database. Notices carry bounded target/gate/proposal identities so
delivery can recheck current relevance, not merely attachment membership. Binding/readiness scans may
read saved notices without acquiring ownership or execution dependencies; live commits use the same
delivery predicate. Revocation and close remove readiness observers.

## Reads and restoration

Reads do not acquire execution ownership. They distinguish a local owner, another live owner and no
owner; saved active work with no live owner is projected as paused/uncertain until a mutation claims
and durably records recovery. No read starts providers. On reacquisition, uncertain effects are never
resent. Reconciliation confirms quiescence and resolves uncertain interventions while preserving
submitted proposals and input/approval gates. It may establish a missing release gate, but never
invents a successful outcome; manual acceptance still needs an explicit reason and satisfied gates.
A storage failure stops local admission and exposes an explicit error; it never publishes the
uncommitted candidate state. Close rejects successful completion if live work or durable cleanup fails.

## Authority

Owner bindings can manage lifecycle but cannot impersonate a human. Authorization precedes receipt
replay; replay precedes version/runtime/history access. Receipts retain their original required gate
authority so replay never reapplies an old edit against a later graph or transfers human authority. Human-only gates bind exact proposals and
history exports. Manual acceptance records an override without rewriting execution success or bypassing
gates. Retry may use its own prior proposals as revision evidence without releasing them. Cross-node
retry seeds require an existing immutable acceptance decision; this preserves historical authorization
without treating a seed as a live dependency or bypassing a release gate. Graph edits preserve historical evidence and invalidate all affected consumers; active
invalidation is rejected. Approval never repairs stale consumed inputs.

## Verification

Public-client tests use temporary storage and deterministic local pi providers, including sessionless
owners, lost ACK replay, frozen fork fan-out, gate authority, controls, branch isolation and recovery.
The in-process and crash-recovery probes share a credential-free local-provider fixture; each sets
its isolated environment before runtime creation. No paid provider or credential discovery is a
default test requirement.
