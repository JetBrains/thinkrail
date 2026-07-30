---
id: submodule-server-git
type: submodule-design
status: active
title: git — runner + worktree status/diff
parent: module-server
depends-on: [module-contracts]
tags: [v1]
---

## Responsibility

Git plumbing: the low-level `git` runner (sync + async) plus a worktree's changed files and diffs over a
**diff scope**, that scope's single definition (the range resolver), a project repo's branch list for the
branch pickers, the workspace branch's own commit list, and a background prefetch that warms a remote base
ref off the workspace-create critical path.

## Boundary

- **Owns:** `git(cwd, args)` (spawn git *sync*, capture trimmed stdout/stderr + ok; `opts.raw` keeps
  stdout byte-exact for file-content reads) and `gitAsync(cwd,
  args)` (its async twin — `Bun.spawn`, off the event loop, for network-bound ops like `fetch` that must
  not block the host);
  **the scope→range resolver** — `resolveDiffRange(ws, scope?)` → `DiffRange` — **the one definition of what
  a `GitDiffScope` means** (`branch`: `git diff <base>` + untracked, sides = base ref ↔ worktree;
  `uncommitted`: `git diff HEAD` + untracked, sides = `HEAD` ↔ worktree; `commit`: `git diff <sha>^ <sha>`, no
  untracked, both sides from history — a **root** commit degrades to `git show --format=` with an empty
  original, the same add-style degradation an absent path already gets). Both reads build their argv from it
  through `changedFileArgs(range, mode)`, so the file list and a file's two sides can never disagree on the
  range — and that argv brackets its revs with **`--end-of-options`**, so no ref can be re-parsed as a git
  option. A `commit` scope's `sha` is validated **twice** — shape (hex-oid regex, so a crafted value can never
  reach a git argument as an option or a path) then existence (`rev-parse --verify`, whose full oid is what is
  then used) — and a vanished commit throws a **`CodedError("UNKNOWN_COMMIT")`** (`@thinkrail/shared/codedError`),
  which the host puts on the wire as `WsResponse.errorCode` and the client turns into "reset the scope, with a
  toast" — *only* for that named failure, never for a timeout or a dropped socket;
  **`isSafeRef(ref)` / `assertSafeRef(ref)`** — the shape check every **user/repo-supplied ref** passes at its
  mutation door (`workspaces`' `createWorkspace` base + `setWorkspaceDiffBase` target): non-empty, no leading
  `-`, no whitespace/control chars, no `..` or revision metacharacters. The threat is an **untrusted
  repository**, not a malicious client: `git update-ref` accepts a name like `refs/heads/--output=x` (only the
  `git branch` porcelain refuses it), `listBranches` reads refs with `for-each-ref`, so an option-shaped
  branch reaches the picker of any repo the user opens — and browsing someone's repo is the product's job;
  **`diffBaseRef(ws)`** — `diffBase ?? baseBranch`, the single collapse of a workspace's two base meanings
  (creation provenance vs review target), consumed by the resolver, `listCommits`, and the `workspaces`
  module's `diffStats`;
  `gitStatus(workspaceId, scope?)` — changed files over the range plus untracked (only when the range ends at
  the worktree), each carrying per-file `added`/`removed` line counts (`git diff --numstat`, its rename-mangled paths resolved
  via `numstatPath` to match `--name-status`; binary rows dropped; untracked files count their whole
  content as added) for the Changes tree's `+/−` badges;
  `gitDiffFile(workspaceId, path, scope?)` → `{ original, modified }` — both sides of one file's change for
  the center Monaco diff tab (`original` = the file at the range's start ref, raw, empty when absent there —
  untracked/added, a renamed file's new path, or a root commit — degrading to an add-style diff; `modified` =
  the worktree file (empty when deleted) for a range ending there, else the commit's own tree; the path is
  escape-checked against the worktree root); **`listCommits(workspaceId)`** → `{ commits: GitCommit[] }` —
  `git log <diff base>..HEAD`, newest first and capped, one control-char-separated `--format` line per commit —
  with every **structured** field ahead of the free-text subject and the parser taking only the leading fields
  positionally (a repository-controlled `%s` *can* contain the separator, so field order, not the separator, is
  what keeps `%an`/`%cI` in place), and control chars stripped from the free-text fields before they go on the wire;
  an unreadable range (deleted base, unborn HEAD) degrades to an empty list so the scope menu still offers its
  other scopes; `listBranches(projectId)` → `{ local, remote,
  defaultBranch }` (local `refs/heads`, remote `refs/remotes/origin` minus `origin/HEAD`, default =
  `origin/HEAD`→`origin/main`→repo `HEAD`); **`resolveDefaultBranch(repoPath)`** — that default-branch
  resolution factored out (named once), shared by `listBranches` and the `workspaces` module's
  Default-workspace ensure (its `baseBranch`); its last fallback is `currentBranch`, so an unborn `HEAD`
  resolves to the branch name it will become, never the literal `"HEAD"` (which would persist into a
  user-visible `baseBranch`); **`currentBranch(repoPath)`** — the branch a checkout currently has out
  (`symbolic-ref --short HEAD`, unborn-safe; detached → literal `HEAD`), consumed by the `workspaces`
  module for the Default workspace's folder-truth `branch`; `prefetchBranch(projectId, ref)` — best-effort background
  `git fetch` of a remote ref (via `gitAsync`, branch passed after `--` so a `-`-prefixed name can't be
  parsed as a git option), so a later `createWorkspace` branches off a fresh tip without the network
  round-trip on its critical path (non-`origin/` ref / offline → no-op).
- **Public surface (barrel):** `git`, `gitAsync`, `gitStatus`, `gitDiffFile`, `listCommits`,
  `resolveDiffRange`, `changedFileArgs`, `diffBaseRef`, `DiffRange`, `isSafeRef`, `assertSafeRef`,
  `listBranches`, `resolveDefaultBranch`, `currentBranch`, `prefetchBranch`.
- **Allowed deps:** `persistence` (workspace + project lookup); `contracts` (`Git*`/`BranchList` types);
  `@thinkrail/shared/codedError` (naming a failure for the wire); Bun (spawn).
- **Forbidden:** `host`; sibling features.

## Get right

- **A scope is defined once.** Any new read that has to know what "the diff" is goes through
  `resolveDiffRange` — never its own `git diff <base>` line — and any read of the base ref goes through
  `diffBaseRef`, so `diffBase ?? baseBranch` exists in exactly one place in the codebase.
- **A commit scope validates that the commit *exists*, not that it is still reachable** from the branch. A
  rebase or reset can rewrite history out from under a selection; the object is still there, and showing its
  diff is *more* useful than silently resetting the user to "All changes". Which commits are *offered* is the
  scope menu's job (`listCommits`), not the read's — so no read pays for a `merge-base --is-ancestor` pair.
- `gitStatus` reports the **live** current branch for a `kind: "default"` workspace (the project
  folder's branch moves out-of-band — a terminal `git checkout` — and the persisted snapshot self-heals
  only at list time; the Changes header must not lag).
