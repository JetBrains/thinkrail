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
  `withUserRemoval`, `observeArtifactSessionEvent`, `ArtifactSessionEvent`, `noteArtifactPathsChanged`,
  `setArtifactsPublisher`, `removeWorkspaceArtifacts`.
- **Allowed deps:** `persistence` (`dataDir`, workspace records), `git` (`gitAsync` for the ignored-root
  listing), `trash` (a discarded kept copy goes to the OS trash), `log`; `contracts`, `shared/paths`,
  `shared/artifactsDir`, `shared/codedError`; Node `fs`/`path`/`crypto`.
- **Forbidden:** `host`, `agent`, `watch`, pi. `host` feeds it session events and change nudges and
  publishes its nudges; it never watches files itself.

## Kept copies

A kept copy is a **hard link** to the live file, so it costs no disk while the file lives and holds the
current content: pi's `write`/`edit` write in place, which the link shares. A writer that replaces the
file (a rename onto it, another inode) is caught at the next reconcile, which relinks. Where linking fails
(the worktree is on another filesystem than the data dir — a Default workspace on a second disk) the copy
is a real copy, refreshed on change, and it costs disk even while the file lives — so real copies are
bounded: a file over 100 MB is not copied, nor one that would take the workspace's real copies (live and
deleted together) past 1 GB. A file left without a copy is still listed but not protected, and when it
vanishes its row goes with it. Hard links have no such bound: they cost nothing until a file is deleted,
and a deleted artifact keeps its copy until the user removes it. Kept copies live in the data dir rather than the worktree so an
agent's `git clean -fdx` or `rm -rf .thinkrail` cannot take them along; the price is that a deleted
artifact is restored before it can be opened.

## Reconcile

`reconcile` walks the artifacts folder (at most 5 000 entries) and diffs it against the index. The walk
never follows a link: `.thinkrail` and `context` must be real directories — a folder replaced by a link is
not walked and marks nothing deleted, while a missing one means everything in it is gone — and no entry
inside is followed. It skips dependency and cache folders (the same set ignored outputs drop, so a mockup
app's `node_modules` neither floods the list nor exhausts the bound) and build-output folders (`dist`,
`build`, `out`, `.next`, `target`, `coverage`): an agent-built mockup inside the artifacts folder rebuilds
hashed assets on every run, and each old hash would otherwise stay forever as a "deleted" row with a kept
copy. Unlike ignored outputs elsewhere, which do list `dist/`, a build inside the artifacts folder is
scaffolding, not something the agent produced for the user and the `fs` delete claims
(`DELETE_CLAIM_PREFIX`), which are the user's own trash in flight, not a rename. A new path gains a record
and a link; a changed size/mtime updates the record (and its writer when known); an inode change relinks;
a missing record whose file now sits at a new path is a **rename** (the row moves, keeping its first-seen
time and chat); any other missing record becomes `deleted` while its kept copy exists — unless the
removal is the user's. Rename by inode alone is trusted only while a hard-linked kept copy holds the
inode; a record kept as a copy (or not kept) must also match size and mtime, because a freed inode is
reused at once on ext4 and XFS, and a different file taking it would otherwise inherit the row and
discard the kept copy. A walk cut short by the bound never marks anything deleted. The host triggers it from file-change nudges under the folder, from every
agent run start, tool end and settle, and from `artifacts.list`; each change publishes one pathless
nudge per workspace.

**User removals** go through `withUserRemoval(workspaceId, path, mutation)`: the path (or folder) is
marked for the mutation's lifetime and reconciled right after it succeeds, so the host's own Delete,
Cut and Rename never read as "deleted not by you", while a failed mutation leaves no mark. A user
deletion made outside ThinkRail (a terminal `rm`) cannot be told from an agent's and shows as deleted;
the user discards it once.

**Restore** first reseeds the artifacts folder through `shared`'s `seedArtifactsDir` (after a
`git clean -fdx` the folder is gone, and recreating it without its `.gitignore` would let `git add -A` stage
the restored draft), then links the kept copy back, refusing a path that exists again (`ENTRY_EXISTS`) or
one whose nearest existing parent resolves outside the worktree. It copies instead when the kept copy is a copy,
or when its inode is still linked elsewhere — the agent moved the file into the project, and a link back
would make editing the artifact edit that project file — and then keeps the restored file afresh. The
restored file's stat is applied before the next reconcile, so a restore is never read as a change and
never moves the row to whichever chat is running. **Discard** moves the kept copy under its original file
name into a staging folder and sends that to the OS trash, so the trash shows a recognizable name; it
drops the row only if it is still the same record, since the agent may have written the path again
meanwhile.

## Attribution

A record's chat is the session that last created or changed it. `write`, `edit` and `spec_create`
name their target in `tool_execution_start` args (resolved as pi resolves it, a leading `@` dropped), so
their writer is exact even with concurrent chats. Such a hint lives only for its own tool call: the
reconcile at that call's `tool_execution_end` reads it and then drops it, so a call that failed without
writing never names the writer of a file another chat creates later.
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
running session settles, a root that is new since the window opened, or holds anything modified since
(with one second of slack: file times can lag the clock by a tick, and the baseline listing runs while the
agent may already be writing), is recorded together with its file count (bounded at 20 000 entries).
Rows are live, never copied.

**Listing never walks an output.** Every walk here is asynchronous and runs only at settle or after a
change, because `artifacts.list` follows most tool ends and a recorded `target/` or `.next/` walked on each
listing stalled the host's one event loop — pi runs on it too. The listing reads the cached counts and
`lstat`s each root once, dropping a root that no longer exists. A change that reaches a recorded root
(`noteArtifactPathsChanged`, fed by the host's file-change publisher — the user's own Delete, Cut, Paste or
Rename land there, while the Linux watcher reports nothing inside ignored folders) recounts that root or
drops it, then nudges the clients; a removed workspace's pending recount is abandoned. A count can
therefore lag a build the user runs in a terminal until the next settle or touching change. A chat without
a project has no git, so its snapshot reports `outputs: null`.

## Lifetime

The store follows its workspace: `host` calls `removeWorkspaceArtifacts` when a workspace or chat is
removed, alongside its other per-workspace state; the worktree's own teardown is not awaited. The index
is validated on load; an unreadable index starts empty rather than failing the workspace. Removing store
entries is best-effort: a kept copy another process holds open (Windows refuses to unlink a hard-linked
file Excel or a scanner has open) is logged and left behind, never allowed to abort a reconcile, a user's
Delete that already succeeded, or the workspace's teardown.
