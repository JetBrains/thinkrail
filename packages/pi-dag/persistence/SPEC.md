---
id: submodule-pi-dag-persistence
type: submodule-design
status: active
title: Durable DAG snapshots, ownership and immutable payloads
parent: module-pi-dag
tags: [backend, dag, public-surface-checked]
---

## Responsibility

Own local per-DAG snapshot durability, exclusive process ownership and immutable captured bytes.
The domain owns snapshot schemas; the runtime owns transitions, evidence capture and publication.

## Boundary

- **Public surface:** `createDagStore`, `DagStore`, `DagLease`

The barrel is the only sibling entrypoint. External dependencies are `node:*`; domain contracts and
validation are consumed through its public barrel. No runtime, extension, delegation internals,
providers, credentials, network, generic I/O abstraction or background expiry service.

## Storage and containment

A trusted configured storage root is resolved at construction, including existing root aliases.
Below it, SHA-256(scope)/dagId contains `state.json`, `payloads/` and `owners/`. Scope strings never
become path components. DAG ids are safe bounded path components. Descendant directories and files
must not be symlinks; content must be regular files. Files use private permissions. Root relocation
is supported by opening a new store at the moved root: persisted references contain only digest and
size, never absolute paths. The storage tree is local and service-managed, not a security boundary
against a concurrent privileged actor replacing its ancestors between filesystem calls.

`read` opens exactly one committed snapshot and decodes it; absence is undefined, corruption or an
unknown schema is an explicit error. `list` enumerates committed snapshots, ignores directories
without one and propagates corrupt-resource errors. Neither read acquires ownership or exports
private snapshots as public payloads. No global resource index or database is maintained.

## Ownership

`claim` publishes a synced, immutable owner record using an exclusive hard link. Records are canonical
JSON with a format version, host, PID and random identity token; noncanonical encodings (including
duplicate keys) are ambiguous and rejected. Each acquisition appends the next numbered record in
that DAG's `owners/`; release publishes a token-matching immutable release marker.
These small records are retained, not removed or compacted. This avoids compare-then-unlink races:
competing recoverers can only contend for the same next slot, never delete a newer owner's lock.
Temporary unpublished files are ignored. Unknown or discontinuous ownership filenames, or malformed
active owner/release records, fail closed. Retired records have no control authority. Unreleased
ownership on another host is ambiguous and blocks acquisition.

A live PID, including this process through another store, blocks claims. Only `kill(pid, 0)` failing
with ESRCH proves an unreleased owner dead. EPERM, unknown failures and reused live PIDs block; age
never authorizes takeover. Save, payload publication and release revalidate the current token.
Reads remain available to competing processes, but `put` requires an admitted lease in that store.
`ownerStatus` samples ownership without acquiring it: released/absent/proven-dead is inactive;
otherwise it is held. Runtime reads use this fact to distinguish another owner from paused recovery;
it is an observation, not a guarantee against subsequent process death or acquisition.

Concurrent saves on one lease are rejected. Release synchronously closes admission, waits for all
admitted saves and payload writes (including failures), then publishes release. Repeated release
returns the same settlement. Losing ownership never authorizes deleting or replacing another token.
An acquisition that fails after publishing its owner record may conservatively remain owned until
process death; ambiguous metadata is never automatically repaired.

## Snapshots

Save detaches and validates the supplied state before its first await. Scope and DAG id must match;
creation requires no current snapshot, expectedVersion undefined and version 1. Updates require
expectedVersion equal to the committed version and exactly one version increment. Graph revision
is domain-owned and independent of this storage CAS. Every read and write uses `decodeState`.

An optional synchronous `beforePublish` check revalidates caller revocation immediately before
issuing the atomic replacement, after asynchronous preparation and ownership checks. A rejected
check cleans the temporary file without publishing. Once replacement has been issued, cancellation
does not roll back a possibly committed command.

Snapshot bytes are canonically encoded into an exclusive temporary file, synced and closed, then
atomically renamed over `state.json`; the containing directory is synced before success. Pending
temporary files are cleaned on failure. No in-memory state cache or speculative publication exists.
Errors before replacement are definite failures; errors after replacement, or ambiguous rename
errors, are `commit-unknown`, requiring a read/identical command replay at the runtime boundary.

## Payloads

`put` detaches Uint8Array input before awaiting. The default quota is LIMITS.valueBytes; explicit
quotas cannot exceed LIMITS.historyBytes. Artifact identity equals the lowercase SHA-256 digest.
Bytes are synced before exclusive publication into the per-DAG payload directory, whose metadata
is also synced before return. Concurrent equal content deduplicates; existing bytes are verified
rather than overwritten. Callers await `put` before saving references; snapshot validation does not
recursively load all historical payloads.

`load` validates reference identity, byte length and digest. Missing, nonregular, symlinked or corrupt
payloads fail explicitly. `reference` checks identity, containment, regular-file status and length,
and returns a fresh path hint without copying/exporting bytes or performing a digest read. Consumers
needing integrity-checked bytes use `load`. Private snapshot paths are never representable by a
StoredFile. All public failures are domain DagError values.

## Verification

Focused Bun tests exercise CAS and detached version-consistent snapshots, immutable payloads and
quotas, relocation, same-process and subprocess ownership, concurrent dead-owner recovery, malformed
ownership, corrupt/unknown state, containment, release/in-flight safety and real filesystem failures.
Narrow test-only rename interception preserves real filesystem operations while arranging permission
failures around replacement and a lost completion after an actual rename; no production fault seam
or generic I/O framework is exposed. Permission tests skip when running as root.
