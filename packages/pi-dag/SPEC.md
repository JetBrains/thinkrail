---
id: module-pi-dag
type: module-design
status: active
title: pi-dag — durable, host-owned orchestration
parent: architecture
depends-on: [module-pi-delegation]
tags: [dag, pi-extension, backend]
---

## Responsibility

A portable backend DAG service and pi extension over [[module-pi-delegation]], independent of
`pi-subagents` and ThinkRail. Pi owns every model invocation, session, compaction and usage record;
this package owns graph scheduling, durable evidence, gates, commands and recovery. It is not
bundled into the ThinkRail V1 product and exposes no UI or wire implementation.

## Boundary

Public package surface: `createDagService`, `createDagExtension`, the default standalone extension,
and the typed command/read/binding contracts. Four reads (`listDags`, `getDag`, `getOutput`,
`listHistory`) and one `execute` dispatcher are the controller surface. No raw AgentSession,
checkpoint CRUD, generic query language, alternate spawner or public effect engine.

Allowed dependencies: `pi-delegation` through its barrel, public pi/typebox peer APIs and `node:*`.
Forbidden: ThinkRail workspace packages, `pi-subagents` policy, pi private fields and sibling internals.
Internal dependency edges are `extension → runtime + domain + pi-delegation`,
`runtime → domain + persistence + pi-delegation`, and `persistence → domain`.
The extension uses domain schemas/contracts directly; its standalone composition creates the delegation
service, while its injected adapter never owns that service. Public DTOs are shared types, not another state owner. Worker tool adapters
are runtime-local and receive narrow callbacks, never a controller client. Each submodule uses a barrel.

## Ownership and execution context

A DAG is a resource, never a fabricated parent session. A scoped service owns live execution;
conversation bindings own only control/notice attachment. An injected service remains host-owned.
ThinkRail's selected integration policy is workspace ownership; other hosts may apply conversation
or service lifetime policies by invoking the same controls. No ownership-mode scheduler is added.
A trusted `owner` binding may perform lifecycle controls, but is not a human and cannot approve or
bypass human-only release. Sessionless construction uses an explicit execution context.

Resource acquisition eagerly retains execution dependencies even when created paused with zero
workers. Exact runtime injection is preferred; standalone registry projection reuses delegation's
opaque provider replay. Retained objects are borrowed, not frozen or secretly disposed. The supplying
owner guarantees their usability for its chosen lifetime; unavailable models/auth paths fail loudly,
never fall back or borrow the latest controlling chat's defaults. No blanket extension-provider ban.

Standalone owners are process-rooted by canonical root/scope, survive chat switches, close on quit
and quiesce on reload. Process loss restores paused; no model invocation survives host exit. The
owner's `close` settles only its resources and preserves resumable state and unrelated parent children.

## Commands and evidence

Mutation identity is caller-supplied `commandId`; non-create requests also name `dagId` and
`expectedVersion`. Authorize, deduplicate, then check version/targets. Changed payload under an
accepted id fails. Replay recovers the original receipt before touching new execution/history inputs.
A receipt acknowledges durable intent, not dispatch, consumption or completion. Actual tool-call ids
are provenance. Expected failures are typed result values; ambiguous I/O requires identical replay.

One node has immutable numbered attempts; each attempt owns one real pi session and numbered
activations. Continue/answer reuse it; retry creates a new session from graph-selected inputs/history.
Save childbirth metadata and declarative shaping, not mutable handle aliases or runtime credentials.
Attempt shaping is one immutable configuration file; current defaults live in the definition, not a
second mutable profile. Missing thinking configuration resolves to `off` if neither the definition
nor the host context supplies it. Delegation's birth scope is retained verbatim and need not equal
this service's storage scope; the resource id binds the two owners.
Outputs, input answers, decisions, consumed inputs and history captures are immutable evidence.
Storage version and graph revision are distinct; streaming deltas do not advance storage versions.

A single acyclic connection collection expresses named data, control and explicit `context: fork`.
No marker means fresh. At most one inherited conversation base per destination; joins never merge
conversations. Node-source forks require accepted output/history release and cannot allow skipping.
Main forks capture a fixed seed on first use, before the invoking tool batch; subsequent main forks
reuse it. Delegation owns canonical capture/validation/forking; this service owns retained bytes and
release authorization. Retry does not implicitly fork the failed attempt. Workers share the checkout.

## Settlement, gates and controls

Workers expose only `dag_submit_result` and `dag_request_input`. The trusted mapping enables curated
extensions and unions both tools into the effective allowlist (within its 64-tool bound). These calls must be the sole tool in
the batch, durably record a proposal/request, and request termination; they are not settlement.
Automatic acceptance requires settled `completed` plus final `stop`/`toolUse`, valid explicit output,
satisfied gates and resolved interventions. Error/length/aborted/absent evidence never auto-accepts.
Manual acceptance preserves the real outcome and cannot bypass gates. Workers approve nothing.
Input requests default to human authority; approval gates explicitly choose human or human-or-controller.
Cancelling a human input gate does not authorize weakening its established policy. An unavailable
history capture blocks fork consumers independently of otherwise authorized output-only consumers;
output approval cannot authorize a later history export. Rejecting that later export does not revoke
already accepted ordinary outputs. A rejection stays authoritative for its exact capture scope;
unrelated edits do not recreate the same gate.

Create is paused. Resume permits admission; pause stops new admission without aborting running work.
Interrupt cooperatively stops queued/active work and holds it for continuation; cancel requires retry.
Dispose is terminal but retains readable history. Restart restores paused; uncertain dispatches need
explicit reconciliation proving old work is no longer live before continue/retry. No blind replay.

Steering is literal, active-invocation-only and best-effort. An observed enqueue before a proposal may
close as offered when the run settles, never as proof of consumption. Late, rejected or uncertain
interventions block automatic acceptance until a later eligible proposal or explicit supersession.
Queue cleanup prevents controls leaking into another activation. Answers use literal continuation,
not steering, and never bypass pause. All run/control promises are awaited outside the state queue.

Edits are atomic typed put/remove operations. Reject changes invalidating active work until explicit
interruption settles. Mark affected consumed attempts stale, including paused/waiting descendants;
supersede their proposals/gates and require retry. Never silently rerun descendants. Skip releases
only eligible non-fork control dependencies; no fabricated named data/history. Policy edits, skip,
manual acceptance or seeds cannot bypass human-only release.

## Durability and reads

Local atomic per-DAG snapshots contain state/history/receipts/intents/notices. Sync immutable payloads
before references; sync/replace the snapshot before ACK. There is one controlling process per resource,
with exclusive ownership checked before mutations; dead-owner recovery is not lease-expiry stealing.
Reads do not claim ownership. They distinguish local, other/indeterminate and inactive ownership;
inactive execution is projected paused/uncertain without writing a snapshot. Unknown/corrupt state
fails closed. Dispatch follows committed intent,
then commits observation. Unobserved effects remain uncertain after process loss; no exactly-once
external-side-effect claim. A failed commit cannot publish speculative in-memory state.

`getDag` is a complete version-consistent current graph/node/gate projection, not private storage.
It includes frozen consumed inputs/configuration, inherited and exported capture provenance/release
status, and acceptance decisions even for control-only nodes with no named output ports. Current
activation gates include their dispositions and decisions, not only pending questions.
Large immutable content uses captured files with identity, SHA-256, byte length and a freshly resolved
path. Existing file tools read them; `getOutput` reads named proposals, not arbitrary transcripts.
History pages are version-pinned and default to 20, at most 100; expired cursors fail explicitly.
Each history row exposes its immutable event manifest plus freshly resolved references to its captured
bodies, so historical definitions, gate questions, outputs and terminal text remain accessible without
a per-entity query or dependence on the private storage layout.

Initial admission bounds: 128 nodes, 512 connections, 32 ports per node, 128-byte ids, 1 MiB serialized
definitions, 16 MiB per submitted value/artifact or materialized literal payload, and 32 MiB per
captured history. Multiple inputs must also fit the literal-payload bound; use artifact references
and explicitly selected file tools for larger working sets. At most one current
proposal or input request per activation is eligible; past evidence stays in history. Snapshot bodies
use captured references/previews so all admitted current identities/topology remain visible. Bounds
are conservative safety limits, not a cap on total historical work. They are validated at mutation
and capture boundaries, never enforced by silently truncating a read.

Notices are durable milestones, delivered passively to attached idle conversations, with readiness
wakeup and revocation/relevance rechecks. Pi submission is not durable transcript ACK; DAG history
remains authoritative. No notice starts a model turn.

## Portable pi adapter

`createDagExtension({ service, executionContext? })` returns a factory over a host-owned service.
The optional synchronous projection returns the current explicit resource context without acquiring
providers or validating credentials; default standalone projection uses the public registry, cwd,
model and thinking setting. Commands bind the actual controller session id and tool-call boundary,
preserve caller `commandId`/`expectedVersion`, and never accept model-supplied actor/session cuts.
A short-lived invocation signal combines tool cancellation with the conversation lifetime. A separate
notice-only binding lives for the conversation; no execution context is retained in that binding.

Five controller tools map directly to the service: `dag_create`, `dag_edit`, `dag_control`,
`dag_decide`, and `dag_read`. The last has only `list`, `get`, `output`, `history` variants over the
four named reads. Results carry the complete structured `DagResult` and readable content preserving
all current identities/topology; bulk text remains captured references. The `tool_result` hook marks
structured failures through pi's public `isError` override, without throwing away their details or
keeping an error-id stash. An ACK is not worker completion.

`/dag <JSON command request>` is the standalone operator path: validate the same request, require a
real interactive confirmation, then bind human authority. Denial or unavailable UI performs no command.
Controller tools never elevate themselves to human authority. The operator uses the current explicit
history boundary; neither path imports arbitrary sessions. Host code can instead bind trusted humans
through the service directly.

The zero-config default installs the same adapter with lazy process-rooted owners keyed by canonical
agent storage root and canonical cwd scope. A versioned global registry, not module-cache lifetime,
holds owners. New/resume/fork shutdown reasons revoke only the old conversation; reload/quit quiesce
all standalone owners (including undisplayed scopes) before replacement/exit. Incompatible retained
registry versions fail loudly rather than adopting old-code runtime objects. Injected services are
never closed by the adapter. Idle-only passive notices use pi messages with `triggerTurn: false`,
wake on `agent_settled`, and detach on revocation. No raw session or second execution loop is exposed.

## Verification

Public-interface tests pin replay/CAS, graph validation, gates and indirect authority bypass, stale
waiting attempts, immutable outputs/history, fork fan-out, pause/interrupt/cancel/continue/retry,
paused recovery, uncertain dispatch, ownership exclusion, failed commits and passive notices.
Delegation tests own pi history mechanics, retained contexts, literal queues and settlement barriers.
A focused integration uses real pi sessions with deterministic local provider behavior; no provider
secrets or paid calls are needed for the default suite. Existing parent/subagent tests remain gates.
