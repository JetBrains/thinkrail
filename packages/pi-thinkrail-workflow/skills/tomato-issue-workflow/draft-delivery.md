# 05 — Draft delivery

Entry: exact repository, source/target branches, commit, validation evidence and applicable delivery authorization are known. Save push/request state and receipt; route to `ready-and-merge.md` only when separately authorized.

## Trigger and entry state

Use for a requested Draft PR/MR push/create/update. A stage label or stage-report receipt is not a delivery prerequisite.

## Automatic steps

1. Read fresh repository identity, source/target branches, commit and provider capability facts.
2. Check for the same active request and verify repository, source and target identity before reuse.
3. For an unapproved automation policy, prepare and present the exact host delivery card; execute only its submitted receipt.
4. Push only the authorized exact commit, non-force; create a Draft request or update the matching active request, never a duplicate.
5. Read back request identity, target and head SHA; report creation/update and CI state separately.

## Host capabilities

The confirmed host delivery operation currently covers non-force push and Draft PR/MR create/reuse/update. It does not grant ready, merge, close or Issue-body update. Check actual provider support before promising the full lifecycle.

## Completion, questions and recovery

A completed stage record is not proof of delivery, and a failed stage record does not block independently eligible delivery. Changed repository, branch, request or commit invalidates the prior card. Do not adopt a request that appeared after confirmation. A possibly dispatched write is read back and reconciled under the original operationId; never blindly retry.

## Handoff

Report committed, pushed, request-created/updated, CI and stage-record states separately. Route to `ready-and-merge.md` only with applicable authorization; route CI repairs through `validation.md` before a later delivery operation.
