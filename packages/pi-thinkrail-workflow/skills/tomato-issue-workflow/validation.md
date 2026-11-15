# 04 — Validate exact changes

Entry: implementation changes are ready for verification. Save checks and their evidence classification against the exact checkout; route to `draft-delivery.md` only when delivery prerequisites are met.

## Trigger and entry state

Use before reporting implementation completion or preparing delivery, and after any commit/tree change that may invalidate prior evidence.

## Automatic steps

1. Read repository, worktree, branch, HEAD, tree and staged/unstaged/untracked status.
2. Read the repository's CI configuration to identify actual commands, runner and platform.
3. Run applicable focused checks and bind each result to exact commit/tree, target, tool version and platform when observable.
4. Classify every check as passed, failed, skipped, not run, not applicable or environment-limited.
5. After any commit, merge, conflict resolution or dependency/lockfile change, assess which evidence is invalid and rerun affected checks.

## E2E state isolation

Before running local E2E, use the repository's public harness and verify that its host data directory
and tool HOME point to its disposable directory under the operating-system temporary directory. The
standard harness sets `THINKRAIL_DATA_DIR` and tool-home variables from `E2E_DATA_DIR`; repository
and workspace records such as `projects.json` and `workspaces.json` must stay in that isolated data
directory, never in the developer's real `~/.oh-my-thinkrail`.

Prefer this isolation over backing up and restoring personal state files. Do not launch a custom host
or override these paths to a real user directory for E2E. If the harness cannot establish isolation,
stop before the run and fix the test setup; do not fall back to the personal state directory.

## Host capabilities

The current workflow may run local checks and read CI/provider facts, but validation is not presumed durable host evidence unless an explicit host record says so. Do not claim a lockfile/frozen install validates a committed tree when uncommitted dependency changes were present.

## Completion, questions and recovery

Only evidence matching the delivery tree counts for that tree. Do not report unchecked platforms or skipped checks as passing. If required commands or platforms cannot run, state the limitation and ask only when a user decision is needed to proceed.

## Handoff

Route to `draft-delivery.md` with the exact commit and validation classifications; route changed cross-repository trees back through `cross-repository.md` as needed.
