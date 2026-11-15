# 03 — Design and implement

Entry: Issue identity and requested stage are verified. Save the design/implementation outcome and unresolved stage-record status; route to `validation.md` after implementation, or return the design handoff to the caller.

## Trigger and entry state

Use for an explicit design or implementation stage. Design is design-only. Implementation begins from its explicit launch without requiring a design-stage receipt or approval label.

## Automatic steps

1. For design, follow the existing `brainstorming` workflow and stop before implementation; return here for Issue handoff.
2. For implementation, reuse the existing plan/TODO mechanisms, inspect owning specs and code, and implement the confirmed requirements.
3. Keep durable decisions in owning specs when boundaries, contracts or documented behavior change.
4. Verify and self-review the implementation. Do not assume a stage update succeeded because work is complete.
5. Evaluate implementation delivery readiness independently of stage publication.

## Host capabilities

Stage reporting uses its own confirmed operation and durable journal. Provider stage labels are records, not authority for code correctness or delivery. Current server support is governed by the Issues module contract; do not infer unavailable lifecycle features from stage support.

## Completion, questions and recovery

Design approval in the request covers only the design; it does not authorize implementation in a design session. Implementation launch needs no second design gate. Clarify conflicts or changes to agreed design. For a refused or uncertain stage write, use `refusals-and-recovery.md` and keep the original operationId.

## Handoff

Design: publish a concise Issue handoff and return to the caller. Implementation: route to `validation.md` and `stage-delivery-decoupling.md`; do not let a failed stage record block separately eligible delivery.
