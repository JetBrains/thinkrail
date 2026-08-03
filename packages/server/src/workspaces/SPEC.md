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
chats. Its **display `name` is decoupled from its git `branch`**: `name` is a human-readable label
(Title Case, spaces) and `branch` is a kebab slug derived from it — they were once held equal, and still
coincide for the auto `workspace-N` placeholder, but a named workspace carries both distinctly.

Every project also carries **exactly one built-in Default workspace** (`kind: "default"`) whose
`worktreePath` is the project folder itself (git's *main working tree*) — the "just work in my project
folder" anchor, ensured lazily, **non-removable and non-renamable**.

## Boundary

- **Owns:** `createWorkspace` (**async**; off `baseRef` when given — branched with `worktree add -b`, never a detached
  remote checkout; off the repo `HEAD` otherwise; **remote-ref freshness is prefetched off this critical
  path** — the New-Workspace dialog `git.prefetch`es the base in the background, so create only `git
  fetch`es as a cheap fallback when the local remote-tracking ref is missing entirely — that fallback runs
  via `gitAsync` (network must not block the event loop) with the branch passed after `--`;
  `Workspace.baseBranch` records **creation provenance** — the ref the worktree was cut from, which never
  moves afterwards (what the diff is measured *against* is the separate, re-pointable `diffBase`; see
  `setWorkspaceDiffBase`); **branch name made unique
  against refs *and* worktree dirs** — archiving leaves the branch behind and renaming frees a branch
  name whose worktree directory stays occupied, so candidate names skip both; path
  `dataDir/worktrees/<project-slug>/<branch>`; **seeds the ephemeral per-workspace scratch dir**
  (`WORKSPACE_CONTEXT_DIR`, with a self-ignoring `*` `.gitignore` — zero git footprint) in the
  new worktree, the home for temp docs (task-specs / working files) that stay out of git yet remain
  scannable by the spec tools (the path convention lives in `@thinkrail/shared/paths`; see
  [[submodule-workflow-skills]]'s artifacts rules); a **user-supplied name is the display name** (casing +
  punctuation preserved via `toDisplayName`; the branch is derived from it) and **sets `renamed: true`** at
  create — the user already chose, so the auto-namer never touches it; auto-`workspace-N` leaves it unset,
  where `name === branch`; **re-reads the registry after the awaited fallback fetch** before appending —
  the pre-await snapshot is stale by then, and saving it would clobber a concurrent list's Default-ensure
  (same discipline as `renameWorkspace`'s re-load after its git subprocess)),
  `renameWorkspace` (**sync**; sets the **display `name`** (sanitized, casing preserved) and derives the
  **git branch** from it via `toBranch`, uniqued against refs + worktree dirs, `git branch -m` from the
  project repo — the branch ref moves and the worktree's HEAD follows, but the **worktree dir never moves**
  (pi keys sessions by exact cwd; terminals/tabs are cwd'd there — the stale dir name is the accepted cost);
  **`name` and `branch` deliberately differ** (e.g. `Fix Auth Redirect` / `fix-auth-redirect`) — the name
  is display-only, never a path/id; only the branch is uniqued (display names may repeat, the branch
  shown beneath the name in the nav disambiguates — see [[submodule-web-panels]]); **re-points sibling
  records whose `baseBranch` **or `diffBase`** was the old branch** in the same save so their provenance stays
  truthful and their diffs don't silently empty, and **emits `updated` for every record it changed** (the
  target plus those siblings) — the server would be right either way, but an unbroadcast sibling leaves its
  clients labelling `vs <old branch>` and keying reads on it until the next `workspace.list`;
  **re-loads the records after the git subprocess** — a record that vanished meanwhile (archived / e2e
  reset) aborts the save instead of resurrecting it; throws on unknown id or git failure — callers decide,
  the auto-rename hook treats it as best-effort. `opts.lock` (default `true`) sets `renamed: true`,
  marking the name deliberate so the auto-namer never touches it again — what a user rename and the
  agentic auto-rename want; the host's **provisional naive rename** passes `lock: false` to rename name +
  branch while leaving `renamed` unset, so the settled-turn agentic pass still refines it),
  `listWorkspaces` (with diff stats), `listWorkspaceRecords` (registry records without per-workspace git
  diffStats — for read-only paths like history scope mapping that must not block on git spawns),
  `workspaceDiffStats`, **`setWorkspaceDiffBase(id, ref | null)`** — re-point the ref this workspace's diff is
  measured against (`Workspace.diffBase`), `null` (or the creation base itself, which would be a redundant
  override) clearing it; persists + **broadcasts the updated record** so every client converges on the push,
  never optimistically (modelled exactly on `setWorkspaceSkillOverride`). Both **ref doors** — this one and
  `createWorkspace`'s `baseRef` — validate the ref's *shape* through the `git` module's `assertSafeRef`
  before it can reach a git argument (an option-shaped branch is reachable from any untrusted repo; see
  [[submodule-server-git]]). `createWorkspace` validates the **resolved** base *unconditionally*, not just a
  client-supplied one: with no base picked it comes from `rev-parse --abbrev-ref HEAD`, i.e. from the
  repository, and an untrusted checkout can have an option-shaped branch checked out (`git branch` refuses such
  a name, `symbolic-ref` does not) — both halves of the same door, closed by one check. **The two base meanings are two
  fields on purpose:** `baseBranch` = where the branch came from, `diffBase` = what its review is measured
  against; collapsing them would make a re-pointed target lie about provenance (the `branch · from
  baseBranch` receipt). Every read of "the base" resolves through the `git` module, never inline —
  `diffStats` composes the git module's **branch-scope range** (`resolveDiffRange` +
  `changedFileArgs(…, "--shortstat")`), so the rail badge measures exactly what the Changes panel shows
  (merge-base semantics included — upstream commits on the base never inflate the badge) and reaches git
  bracketed by `--end-of-options` … `--` like every other rev this app passes. `diffStats` yields **no stats at all** (logged) when git couldn't
  answer, rather than a fabricated `+0 −0` — a failed read must not paint a dirty worktree as clean; the
  `Workspace.diffStats` field is simply absent, and `workspaceDiffStats` rejects,
  `getWorkspace` (by-id lookup, throws on unknown — anchors a chat session's cwd),
  and the **archive** primitives, split so the fast record-drop
  and the slow git reclaim are separable (the host archives off the request's critical path):
  `forgetWorkspace(id)` (drop the persistence record, return the removed record or `null` — gone from
  `listWorkspaces` immediately), `reclaimWorktree(ws)` (the slow half — `git worktree remove --force`,
  keeps the branch; hardened: rm + `prune` if git fails; **refuses the Default and, defense-in-depth,
  any record whose `worktreePath` resolves to the project folder** — the rm-fallback must never see the
  user's repo, however a corrupt/hand-edited record got there), and `removeWorkspace(id)` (the synchronous
  composition of the two, kept for callers/tests that want the whole archive in one call).
- **Default workspace (`kind: "default"`):** exactly one per project. `listWorkspaces` **ensures** it
  — find-or-create by `projectId`+`kind` (id a plain `randomUUID`; the `kind` field is the marker,
  never an id convention), **collapsing duplicates** defensively if out-of-band state churn ever
  produced two — and returns it **pinned first**. The in-list ensure is a **deliberate CQS exception**:
  the query performs a registry write + lifecycle emit so that *any* caller self-heals out-of-band state
  churn (backfills projects opened before the feature; the e2e reset rewrites `workspaces.json` mid-run)
  — the write is to the app's registry under the data dir, never into the user's repo. No `git worktree
  add` (the folder already is the
  main working tree) and **no scratch-dir seeding at ensure** — merely listing a project must never
  write into the user's repo (see `ensureWorkspaceScratchDir`). Fields are folder-truth, refreshed at
  list time when drifted — **emitting `updated`** so every client's rail converges instead of one tab
  staying stale after a terminal `git checkout` (`renameWorkspace` uses the same channel for the same
  fields; the store's merge triggers no re-list, so there's no feedback loop): `branch` = the
  folder's current HEAD (`symbolic-ref --short`, unborn-safe; detached → literal `HEAD`), `baseBranch`
  = the repo's default branch via `git`'s `resolveDefaultBranch` (unborn-safe — its last fallback is
  `currentBranch`, so the literal `"HEAD"` never persists) — so Default's Changes measure like
  any workspace, degenerating to uncommitted work when the folder sits on the default branch itself.
  Drift is **not** only a list-time discovery: `refreshDefaultWorkspace(workspaceId)` is the same
  re-sync **without** the diff-stat listing (two cheap git reads; unknown id / a worktree workspace /
  no drift → no save, no emit), which the host wires to `watch`'s **repo-metadata nudge** (host-mediated,
  `watch` has no `workspaces` edge — see [[submodule-server-watch]]). So a `git switch` in the Default
  workspace's terminal converges the rail, the top bar and the empty receipt live, instead of leaving
  them on the old branch until a manual project reload — including a switch that leaves the working tree
  byte-identical (`git switch -c`), which writes nothing outside `.git` (`gitStatus` reads its header branch live for
  the same reason — see [[submodule-server-git]]).
  First materialization emits `created` (idempotent for stores); a drift-free list emits nothing. Every
  ensure emit — `created`, `updated`, the collapse's `removed`s — happens **after** the save, matching
  the module's persist-then-publish order everywhere else. **Non-removable + non-renamable,
  enforced here, not just hidden in the UI:** `forgetWorkspace` and `renameWorkspace` **throw** on
  `kind: "default"` — forget would hand the archive teardown's `rm -rf` fallback the project folder,
  rename would `git branch -m` the user's real branch; the record carries `renamed: true` so both
  auto-rename passes stay away as belt-and-suspenders.
- **`ensureWorkspaceScratchDir(ws)`** — idempotent seed of the gitignored `WORKSPACE_CONTEXT_DIR`
  scratch dir (mkdir + self-ignoring `*` `.gitignore`); the host calls it on **session create** for
  every workspace, so the Default workspace writes into the user's repo only when a chat actually
  starts there (worktree creation still seeds eagerly at create; this also self-heals a worktree
  whose scratch dir was deleted). Hardened, because in the Default workspace it runs against
  **repository-controlled content**: it **throws when the workspace root is missing** (an externally
  deleted worktree must fail the session loudly, not be resurrected as an empty non-git dir); it
  **refuses symlinked path components** (`lstat`, never followed — a malicious checkout can't redirect
  the seed outside the workspace); and the `.gitignore` write is **exclusive-create (`wx`) — only when
  the file is absent**: in the Default workspace that path is inside the user's own repo, where an
  existing (possibly tracked, possibly customized) file is theirs to keep, and `O_EXCL` never follows
  a (possibly dangling) symlink; seeding fills the gap, never overwrites (pinned by regression tests).
- **Lifecycle events:** every membership mutation — `createWorkspace` (`created`), `renameWorkspace`
  (`updated`, both the naive and agentic auto-rename passes since both go through it), `forgetWorkspace`
  (`removed`) — emits a `WorkspaceLifecycleEvent` through an **injected publisher** (`setWorkspacePublisher`,
  the same inversion `terminal`/`agent`/`auth` use; `null` in unit tests / the e2e reset → silent no-op).
  The module stays ignorant of WS channels: it emits a domain event (`created`/`updated` carry the record,
  `removed` carries `{ projectId, id }`) and the host maps `kind` → `workspace.*` channel. This makes the
  module the **single source of workspace lifecycle pushes** (the auto-rename tee no longer pushes — rename
  self-publishes), so registry membership stays shared domain state across every client (architecture #9).
- **Public surface (barrel):** `createWorkspace`, `listWorkspaces`, `listWorkspaceRecords`, `forgetWorkspace`,
  `reclaimWorktree`, `removeWorkspace`, `workspaceDiffStats`, `getWorkspace`, `renameWorkspace`,
  `refreshDefaultWorkspace`, `ensureWorkspaceScratchDir`,
  `setWorkspacePublisher`, `WorkspaceLifecycleEvent`.
- **Allowed deps:** `projects` (repo lookup), `git` (the runner), `persistence`; `contracts`;
  `@thinkrail/shared/paths` (the scratch-dir path convention); Node.
- **Forbidden:** `host`; reaching into another feature's internals (use its barrel).
