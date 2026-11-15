# 11 — Decouple stage and delivery

Entry: implementation is complete enough to assess delivery while stage report/label publication may fail or remain uncertain. Save stage status and delivery status independently; continue only the path whose own conditions are met.

## Trigger and entry state

Use whenever implementation stage prepare, continuation, execution or receipt recovery fails around an otherwise deliverable implementation.

## Automatic steps

1. Classify and report stage state accurately: confirmed, rejected before intent, failed, or uncertain.
2. Repair only safe in-scope stage prerequisites; inspect/reconcile any existing intent under its original operationId.
3. Independently assess exact commit, validation evidence, repository, source/target and delivery authorization.
4. If delivery conditions hold, continue through `draft-delivery.md` even if stage state remains unresolved; otherwise repair a safe prerequisite or state the concrete blocker.
5. Report stage and delivery results separately. Never convert stage uncertainty into stage success.

## Host capabilities

Stage confirmation and Draft delivery use separate host operations. A stage label/report is a lifecycle record, not a delivery readiness gate. The host must still enforce delivery's own authorization and immutable operation rules.

## Completion, questions and recovery

No warning/exception card is required to bypass a stage gate: there is no stage gate for eligible delivery. Do not bypass delivery authorization or real uncertainty. Do not repeatedly submit a known invalid continuation; classify it and use the documented host recovery route.

## Handoff

Route eligible delivery to `draft-delivery.md`; route unresolved stage writes to `refusals-and-recovery.md` in parallel. Return to the caller only after reporting both states and their independent next steps.
