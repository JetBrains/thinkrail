# 07 — Pair repositories

Entry: an explicit repository dependency order and target branches are known. Save upstream merge evidence and downstream pairing/validation results; route each downstream repository through its normal validation and delivery path.

## Trigger and entry state

Use when a task changes or delivers more than one repository with an API, ABI, protocol, shared dependency or lockfile relationship.

## Automatic steps

1. Build the upstream → downstream dependency order and freeze each repository's worktree and target.
2. Validate and deliver the upstream repository under its own policy.
3. Read the actual upstream target branch SHA after merge; never substitute source-branch HEAD.
4. Before changing downstream pairing/lock data, inspect target SHA, ancestry, compatibility and likely conflicts.
5. Resolve any conflict, update pairing only after checks, and rerun affected validation on the final downstream tree.

## Host capabilities

Repository membership and Git/provider reads do not establish ABI/protocol compatibility. The host does not infer compatibility from independent CI success. A merge preview detects conflicts but is not final verification.

## Completion, questions and recovery

Do not update downstream locks when upstream target SHA or compatibility is unknown. Ask for technical/user decisions only where required; report a concrete blocker otherwise. A changed upstream target invalidates dependent pairing evidence.

## Handoff

Route downstream changes to `validation.md`, then `draft-delivery.md`. Return to the caller with per-repository target and observed SHA evidence.
