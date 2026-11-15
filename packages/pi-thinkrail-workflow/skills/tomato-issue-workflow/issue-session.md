# 01 — Enter and resume

Entry: an explicit Tomato Issue request names design or implementation and a provider-qualified Issue. Save the verified binding and current stage; route to `plan-and-targets.md` for unresolved scope, or to the requested lifecycle use case.

## Trigger and entry state

Start only from the explicit launch, never from a referenced Issue or label. Require provider, instance, project and Issue id. The host supplies bound repositories and the active workspace/session.

## Automatic steps

1. Verify `issue_context` and `issue_record_summary` are available before work.
2. Read fresh Issue description, returned comments and references. Verify returned identity matches the launch.
3. Read each bound repository's instructions and relevant owning specs; do not combine or execute repository configuration.
4. On resume, reread host context and structured operation state relevant to the next action.

## Host capabilities

`issue_context` provides current bound context and repositories; `issue_record_summary` records the sanitized handoff. Host-bound repositories identify scope, not a shell sandbox. Do not impose an extra completeness-marker or comment-count gate.

## Completion, questions and recovery

A valid session has matching Issue identity, explicit stage and usable context. Missing identity or failed context read blocks work. Ask only for a missing or conflicting requirement that changes the requested work. Never guess a repository, workspace, stage, target or permission.

## Handoff

Route to `plan-and-targets.md` when target/scope decisions remain; otherwise route to `design-and-implementation.md`, `validation.md`, or the requested delivery use case. On blocked/partial work, return to the caller after publishing via `issue_record_summary`.
