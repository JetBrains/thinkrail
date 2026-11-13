---
id: submodule-server-artifacts
type: submodule-design
status: active
title: artifacts — the workspace's agent artifacts and their kept copies
parent: module-server
depends-on: [module-contracts, submodule-server-persistence, submodule-server-trash, submodule-server-git]
references: [submodule-server-watch, submodule-server-turns, submodule-server-host]
tags: [artifacts, persistence, public-surface-checked]
---

## Responsibility

The host-owned index behind the Artifacts tool: what an agent left in a workspace, who wrote it, and a
kept copy of each file so nothing in the artifacts folder disappears unless the user removes it. An
**artifact** is a regular file under the worktree's `.thinkrail/context/` (`WORKSPACE_CONTEXT_DIR`), except
the seeded `.gitignore` and the TODO state under `todos/`. An **ignored output** is a gitignored file or
folder elsewhere in a git worktree that appeared or changed while an agent ran. The index is host state,
not a web derivation: only the host sees every run (attended or not), can keep copies, and serves every
client the same answer.

## Boundary

- **Owns:** `<dataDir>/artifacts/<workspaceId>/` — `index.json` (artifact records + ignored-output records)
  and `kept/<uuid>` — plus the in-memory per-workspace running set, explicit writers and run window.
- **Public surface (barrel):** `listArtifacts`, `reconcileArtifacts`, `restoreArtifact`, `discardArtifact`,
  `withUserRemoval`, `observeArtifactSessionEvent`, `ArtifactSessionEvent`, `touchesArtifacts`,
  `setArtifactsPublisher`, `removeWorkspaceArtifacts`.
- **Allowed deps:** `persistence` (`dataDir`, workspace records), `git` (`gitAsync` for the ignored-root
  listing), `trash` (a discarded kept copy goes to the OS trash), `log`; `contracts`, `shared/paths`,
  `shared/codedError`; Node `fs`/`path`/`crypto`.
- **Forbidden:** `host`, `agent`, `watch`, pi. `host` feeds it session events and change nudges and
  publishes its nudges; it never watches files itself.

## Kept copies

A kept copy is a **hard link** to the live file, so it costs no disk while the file lives and holds the
current content: pi's `write`/`edit` write in place, which the link shares. A writer that replaces the
file (a rename onto it, another inode) is caught at the next reconcile, which relinks. Where linking fails
(the worktree is on another filesystem than the data dir — a Default workspace on a second disk) the copy
is a real copy, refreshed on change and only for files up to 100 MB; a larger one is not protected, and
when it vanishes its row goes with it. Kept copies live in the data dir rather than the worktree so an
agent's `git clean -fdx` or `rm -rf .thinkrail` cannot take them along; the price is that a deleted
artifact is restored before it can be opened.

## Reconcile

`reconcile` walks the artifacts folder (symlinks never followed, at most 5 000 entries) and diffs it
against the index: a new path gains a record and a link; a changed size/mtime updates the record (and its
writer when known); an inode change relinks; a missing record whose inode now sits at a new path is a
**rename** (the row moves, keeping its first-seen time and chat); any other missing record becomes
`deleted` while its kept copy exists — unless the removal is the user's. A walk cut short by the bound
never marks anything deleted. The host triggers it from file-change nudges under the folder, from every
agent run start, tool end and settle, and from `artifacts.list`; each change publishes one pathless
nudge per workspace.

**User removals** go through `withUserRemoval(workspaceId, path, mutation)`: the path (or folder) is
marked for the mutation's lifetime and reconciled right after it succeeds, so the host's own Delete,
Cut and Rename never read as "deleted not by you", while a failed mutation leaves no mark. A user
deletion made outside ThinkRail (a terminal `rm`) cannot be told from an agent's and shows as deleted;
the user discards it once.

**Restore** links the kept copy back (a copy when it is one), refusing a path that exists again
(`ENTRY_EXISTS`) or one whose nearest existing parent resolves outside the worktree. **Discard** moves the
kept copy under its original file name into a staging folder and sends that to the OS trash, so the
trash shows a recognizable name.

## Attribution

A record's chat is the session that last created or changed it. `write`, `edit` and `spec_create`
name their target in `tool_execution_start` args, so their writer is exact even with concurrent chats.
Any other change (a shell command, a tool writing on its own) is attributed only while exactly one
session of the workspace is running; otherwise the record keeps the chat it had. Like [[submodule-server-turns]]
this is not exclusive attribution, and a session that never settles (a host crash) stays "running" until
restart.

## Ignored outputs

The watcher never watches ignored folders on Linux (see [[submodule-server-watch]]), so outputs are found
by snapshot. The first `agent_start` in a workspace opens a run window and lists the ignored roots with
`git ls-files --others --ignored --exclude-standard --directory` — git collapses an ignored folder into one
entry without descending, so a folder is one row. Roots under a dependency or cache folder
(`node_modules`, `.venv`, `__pycache__`, `.turbo`, `.cache`, …) and `.thinkrail` are dropped. When the last
running session settles — and on `artifacts.list` while one runs — a root that is new since the window
opened, or holds anything modified since (with one second of slack: file times can lag the clock by a
tick, and the baseline listing runs while the agent may already be writing), is recorded. Rows are live, never copied: the listing counts the
folder's files (bounded at 20 000 entries) and drops a root that no longer exists. A chat without a
project has no git, so its snapshot reports `outputs: null`.

## Lifetime

The store follows its workspace: `host` calls `removeWorkspaceArtifacts` when a workspace or chat is
removed, alongside its other per-workspace state; the worktree's own teardown is not awaited. The index
is validated on load; an unreadable index starts empty rather than failing the workspace.
