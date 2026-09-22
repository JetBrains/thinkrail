---
id: submodule-pi-dag-extension
type: submodule-design
status: active
title: Portable pi DAG adapter
parent: module-pi-dag
---

## Boundary

Owns pi tool/command registration, trusted conversation provenance, transient context/history
projections, passive notice delivery and standalone composition. The public barrel exposes
`createDagExtension`, `DagExtensionOptions`, and `default` (the zero-config extension factory).
External dependencies are public pi APIs, typebox, pi-delegation's barrel and Node APIs. Sibling
edges are declared in the parent spec. Forbidden reaches: runtime/domain/delegation internals,
ThinkRail/UI/server packages, pi private fields, credential copying and independent worker loops.

## Adapter

The injected service is always host-owned and never closed here. Five controller tools use domain
schemas and map directly to execute or the four named reads. Caller command ids and versions are
unchanged. Results retain the entire DagResult in details and JSON text; admitted DTOs already
capture bulk bodies, so no presentation cap may hide topology or gate identities. The public
`tool_result` override marks structured failures without a per-call stash.

Each session_start rotates one lifetime and one notice-only binding. Commands bind the actual
session id, combine invocation cancellation with lifetime revocation, and revoke their short binding
in finally. Execution projection is synchronous and current, never retained as a callback by the
service; undefined is passed through so backend receipt replay precedes context requirements.
Reads do not project execution context. Controller history uses the real manager and the actual
execute toolCallId before-tool-call cut, not commandId.

`/dag` parses and validates RequestSchema, then requires hasUI and explicit confirmation of the
complete unchanged request. TUI and RPC confirmation are supported; noninteractive modes do nothing.
Human provenance is `operatorId: pi:<actual session id>` with that conversation id. After confirmation,
recheck the captured lifetime before projecting context and an at-entry cut of the current history.
No tool accepts an actor or elevates to human. Operator results are passive custom messages.

Notice sinks check captured identity, current lifetime and isIdle before submitting a custom
`dag-notice` message with triggerTurn:false. agent_settled wakes readiness listeners; agent_end does
not. Revocation removes listeners and all retained context closures. Backend bind restores notices
by read-only scans; attaching does not claim execution ownership. This requires runtime attachment
identity to unify a controller's sessionId with a human's explicit conversationId. The current runtime
uses distinct session:/human: keys; until its owner reconciles that contract, operator-created or
operator-attached notices cannot reach the single controller notice binding. The adapter does not
invent a second observer or a hidden attach command to mask that service boundary gap.

## Standalone owners

A lazy versioned globalThis Symbol.for registry, not module cache persistence, owns scoped services.
Keys contain canonical agent root and cwd; scope is the cwd's SHA-256. Storage is under the canonical
agent root's dags and delegation directories. Canonicalization resolves the nearest existing ancestor
for initially absent directories and propagates errors other than ENOENT. Dangling symlinks fail
rather than creating a noncanonical owner key. Acquisition and insertion
are synchronous, so shutdown cannot miss an in-flight owner acquisition. Once shutdown begins,
acquisition fails until all closes finish and the registry is removed. Close failures retain the
blocked registry and propagate; incompatible registry versions/shapes fail loudly.

New/resume/fork revoke conversation bindings only. Quit/reload await every retained owner's close,
including undisplayed scopes, before clearing the registry. Replacement code acquires fresh services
and sees paused durable resources. The registry retains no pi/context closures. Delegation owns
provider replay and resource execution; borrowed provider callbacks remain the supplying host's
lifetime contract, not a blanket adapter restriction.

## Verification

Public-adapter tests use real pi sessions and isolated local faux models/credential stores. Typed
service-client doubles isolate forwarding, provenance, confirmation and notice delivery from backend
policy. Real-service cases pin invocation history, complete reads and standalone lifetime. Tests cover direct mapping, identity/history
cuts, replay without replacement execution context, structured errors, passive idle notices, switch
survival, process-registry module replacement and all-scope quiescent reload/quit. Reads must not invoke
providers. No paid/network providers, host bundling or duplicate backend policy tests.
