# 02 — Plan targets

Entry: a bound Issue session needs repository, branch, scope or dependency decisions. Save an explicit per-repository target and ordered dependencies; route to the first applicable lifecycle phase.

## Trigger and entry state

Use when requested work crosses repositories, changes target/scope, or asks for an end-to-end delivery whose provider capabilities are not yet known.

## Automatic steps

1. Identify each repository, its host-bound worktree, source branch and intended target branch from observed facts or user choice.
2. Display the mapping as repository → target branch before any delivery action.
3. For multiple repositories, record a directed dependency order and which upstream target SHA must be read before downstream pairing.
4. Check provider/host support for every requested remote action before planning it as executable.
5. Re-evaluate dependent state, validation evidence and authorizations whenever target, repository or scope changes.

## Host capabilities

Repository identity/worktree binding, project default branch reads and provider capability discovery are host facts. A default branch may be absent; never guess `main` or use the source branch as target. A primitive does not grant authorization.

## Completion, questions and recovery

A plan is actionable only when each repository's source, target, expected action and completion condition are explicit. Ask for missing user intent; report unsupported actions as capability gaps before delivery. Preserve uncompleted acceptance criteria when revising TODOs.

## Handoff

Route to `cross-repository.md` for paired repositories, then `design-and-implementation.md` or `validation.md`. Use `draft-delivery.md` only after scope, target, capability and applicable authorization are clear.
