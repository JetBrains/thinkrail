# 09 — Wait and resume

Entry: CI/remote work is waiting or a bound session is resumed. Save only meaningful state transitions and the next unfinished action; hand off on a terminal state, decision or concrete blocker.

## Trigger and entry state

Use for CI waits, long-running delivery, interruption or session recovery.

## Automatic steps

1. Read structured target, commit/tree, request, pipeline, validation and operation/authorization state from host sources.
2. Poll/wait through the available host capability; suppress unchanged ordinary progress updates.
3. On a state change, report only the change and continue the already authorized path.
4. On resume, reread live facts and compare them with frozen identity and authorization before any mutation.
5. Preserve completed TODO history and all unfinished acceptance criteria during replanning.

## Host capabilities

Use host state and provider reads; do not reconstruct authorization from chat history. If durable wait state or pipeline monitoring is absent, state the limitation and use an available bounded read path without claiming continuous monitoring.

## Completion, questions and recovery

Stop for a policy-external decision, changed identity/target, or specific hard blocker. For uncertain operations route to `refusals-and-recovery.md`. Do not treat a timeout or missing status as success or proof that no write happened.

## Handoff

On completion or blocker, return to the owning use case (`draft-delivery.md`, `ready-and-merge.md`, or `issue-acceptance-and-close.md`) with the latest observed state.
