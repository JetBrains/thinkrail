---
id: submodule-server-workspaces
type: submodule-design
status: active
title: workspaces — git worktrees
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

A workspace is a `git worktree` on its own branch under the data dir — the anchor for files/git/terminals/
chats.

## Boundary

- **Owns:** `createWorkspace` (**async**; off `baseRef` when given — branched with `worktree add -b`, never a detached
  remote checkout; off the repo `HEAD` otherwise; **remote-ref freshness is prefetched off this critical
  path** — the New-Workspace dialog `git.prefetch`es the base in the background, so create only `git
  fetch`es as a cheap fallback when the local remote-tracking ref is missing entirely — that fallback runs
  via `gitAsync` (network must not block the event loop) with the branch passed after `--`;
  `Workspace.baseBranch` records the base the diff is measured against; **branch name made unique
  against refs *and* worktree dirs** — archiving leaves the branch behind and renaming frees a branch
  name whose worktree directory stays occupied, so candidate names skip both; path
  `dataDir/worktrees/<project-slug>/<branch>`; **seeds the ephemeral per-workspace scratch dir**
  (`WORKSPACE_CONTEXT_DIR`, with a self-ignoring `*` `.gitignore` — zero git footprint) in the
  new worktree, the home for temp docs (task-specs / working files) that stay out of git yet remain
  scannable by the spec tools (the path convention lives in `@thinkrail/shared/paths`; see
  [[submodule-workflow-skills]]'s artifacts rules); a **user-supplied name sets `renamed: true`** at create —
  the user already chose, so the auto-namer never touches it; auto-`workspace-N` leaves it unset),
  `renameWorkspace` (**sync**; slugs + uniques the requested name, `git branch -m` from the project repo
  — the branch ref moves and the worktree's HEAD follows, but the **worktree dir never moves** (pi keys
  sessions by exact cwd; terminals/tabs are cwd'd there — the stale dir name is the accepted cost);
  keeps the `name === branch` invariant by setting both to the final unique branch; **re-points sibling
  records whose `baseBranch` was the old branch** in the same save so their diffs don't silently empty;
  **re-loads the records after the git subprocess** — a record that vanished meanwhile (archived / e2e
  reset) aborts the save instead of resurrecting it; throws on unknown id or git failure — callers decide,
  the auto-rename hook treats it as best-effort. `opts.lock` (default `true`) sets `renamed: true`,
  marking the name deliberate so the auto-namer never touches it again — what a user rename and the
  agentic auto-rename want; the host's **provisional naive rename** passes `lock: false` to rename name +
  branch while leaving `renamed` unset, so the settled-turn agentic pass still refines it),
  `listWorkspaces` (with diff stats), `workspaceDiffStats`, `getWorkspace` (by-id lookup, throws on
  unknown — anchors a chat session's cwd), and the **archive** primitives, split so the fast record-drop
  and the slow git reclaim are separable (the host archives off the request's critical path):
  `forgetWorkspace(id)` (drop the persistence record, return the removed record or `null` — gone from
  `listWorkspaces` immediately), `reclaimWorktree(ws)` (the slow half — `git worktree remove --force`,
  keeps the branch; hardened: rm + `prune` if git fails), and `removeWorkspace(id)` (the synchronous
  composition of the two, kept for callers/tests that want the whole archive in one call).
- **Lifecycle events:** every membership mutation — `createWorkspace` (`created`), `renameWorkspace`
  (`updated`, both the naive and agentic auto-rename passes since both go through it), `forgetWorkspace`
  (`removed`) — emits a `WorkspaceLifecycleEvent` through an **injected publisher** (`setWorkspacePublisher`,
  the same inversion `terminal`/`agent`/`auth` use; `null` in unit tests / the e2e reset → silent no-op).
  The module stays ignorant of WS channels: it emits a domain event (`created`/`updated` carry the record,
  `removed` carries `{ projectId, id }`) and the host maps `kind` → `workspace.*` channel. This makes the
  module the **single source of workspace lifecycle pushes** (the auto-rename tee no longer pushes — rename
  self-publishes), so registry membership stays shared domain state across every client (architecture #9).
- **Public surface (barrel):** `createWorkspace`, `listWorkspaces`, `forgetWorkspace`, `reclaimWorktree`,
  `removeWorkspace`, `workspaceDiffStats`, `getWorkspace`, `renameWorkspace`, `setWorkspacePublisher`,
  `WorkspaceLifecycleEvent`.
- **Allowed deps:** `projects` (repo lookup), `git` (the runner), `persistence`; `contracts`;
  `@thinkrail/shared/paths` (the scratch-dir path convention); Node.
- **Forbidden:** `host`; reaching into another feature's internals (use its barrel).
