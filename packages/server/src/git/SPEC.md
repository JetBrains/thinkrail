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

- **Owns:** `git(cwd, args, opts)` (spawn git *sync*, capture trimmed stdout/stderr + ok; `opts.raw` keeps
  stdout byte-exact for file-content reads) and `gitAsync(cwd, args)` (its async twin — `Bun.spawn`, off the
  event loop, for network-bound ops like `fetch` that must not block the host; no options — it never needed
  `env`/`raw`) — both route their argv through **`gitArgv(cwd, args)`**, extracted (and exported) so the flag
  set is assertable without spawning: it unconditionally prepends **`--no-optional-locks`**, git-level and so
  must sit before the subcommand, alongside `-C` (see Get right — there is no opt-out; every writer this
  repo has succeeds under it);
  **the scope→range resolver** — `resolveDiffRange(ws, scope?)` → `DiffRange` — **the one definition of what
  a `GitDiffScope` means**:

  | scope | list command | untracked | original | modified |
  |---|---|---|---|---|
  | `branch` | `diff <merge-base>` | yes | merge-base ref | worktree |
  | `working-tree` | `diff` (no revs) | yes | index | worktree |
  | `staged` | `diff --cached HEAD` | no | `HEAD` | index |
  | `commit` | `diff <sha>^ <sha>` / `show` for a root | no | parent / empty | `sha` |

  `branch`'s merge-base ref is the **fork point** of the diff base and `HEAD` — what the workspace changed
  *since diverging*, so a base that advanced underneath it (a fetch moving `origin/main`, upstream work
  landing) never surfaces as phantom changes; while the base hasn't diverged the merge-base *is* its tip,
  and a failed `merge-base` (missing base, unrelated histories, unborn `HEAD`) falls back to the raw ref,
  keeping the old error surfaces — and keeping the file list ancestry-consistent with `listCommits`'
  `base..HEAD`. `working-tree` and `staged` split what a single conflated `uncommitted` scope used to lump
  together, now that the index is a real `DiffSide`: `working-tree` is what you have not staged yet (index vs
  worktree, plus untracked — nothing staged belongs here), `staged` is what a commit would record right now
  (`HEAD` vs the index, no untracked — untracked is by definition not staged). A **root** `commit` degrades to `git show
  --format=` with an empty original, the same add-style degradation an absent path already gets. Both reads
  build their argv from it through `changedFileArgs(range, mode)`, so the file list and a file's two sides
  can never disagree on the range — and that argv brackets its revs on **both** sides: **`--end-of-options`** ahead of them (no ref can be
  re-parsed as a git option) and a trailing **`--`** after them (a rev that also names a path on disk — a branch
  called `docs` — is read as a rev instead of failing the command as an "ambiguous argument"). A **failed**
  `git diff`/`git show` **throws**; it is never reported as an empty change set (see Get right). A `commit` scope's `sha` is validated **twice** — shape (hex-oid regex, so a crafted value can never
  reach a git argument as an option or a path) then existence (`rev-parse --verify`, whose full oid is what is
  then used) — and a vanished commit throws a **`CodedError("UNKNOWN_COMMIT")`** (`@thinkrail/shared/codedError`),
  which the host puts on the wire as `WsResponse.errorCode` and the client turns into "reset the scope, with a
  toast" — *only* for that named failure, never for a timeout or a dropped socket;
  **`isSafeRef(ref)` / `assertSafeRef(ref)`** — the shape check every **user/repo-supplied ref** passes at its
  mutation door (`workspaces`' `createWorkspace` base — the **resolved** one, including the value read off the
  repo's own `HEAD` — + `setWorkspaceDiffBase` target). The rule set is `git check-ref-format`'s, reproduced
  in-process (no spawn on a validation path): non-empty, no leading `-`, no whitespace/control chars, no `..`,
  no revision metacharacters (`~ ^ : ? * [ \`), no `@{` and no bare `@`, no empty path component, no component
  starting with `.`, no `.lock` suffix, no trailing `.` or `/`. A name git itself refuses is never one we accept
  — and, symmetrically, **no length cap**: `check-ref-format` has none, so a long hierarchical branch the repo
  really has (and `for-each-ref` really lists) stays selectable; length is not a safety property, and the real
  limits (filesystem component cap, argv size) fail loudly as a read error instead of "malformed". The threat is an **untrusted
  repository**, not a malicious client: `git update-ref` accepts a name like `refs/heads/--output=x` (only the
  `git branch` porcelain refuses it), `listBranches` reads refs with `for-each-ref`, so an option-shaped
  branch reaches the picker of any repo the user opens — and browsing someone's repo is the product's job;
  **`diffBaseRef(ws)`** — `diffBase ?? baseBranch`, the single collapse of a workspace's two base meanings
  (creation provenance vs review target), consumed by the resolver and `listCommits` (the `workspaces`
  module's `diffStats` reaches it *through* the resolver — see Get right);
  `gitStatus(workspaceId, scope?)` — changed files over the range plus untracked (only when the range ends at
  the worktree), each carrying per-file `added`/`removed` line counts (`git diff --numstat`, its rename-mangled paths resolved
  via `numstatPath` to match `--name-status`; binary rows dropped; untracked files count their whole
  content as added) for the Changes tree's `+/−` badges. **Deduped by path**: an unmerged (conflicted) path —
  a live `merge`/`rebase`/`cherry-pick` — is not a hypothetical, and git's `--name-status` prints it **twice**
  for `working-tree` scope (a generic `U` marker row, then a second row comparing stage 2 against the
  worktree when one exists); the second, more substantive row wins, so the Changes list — and its
  React `key={change.path}` — never doubles the file;
  `gitDiffFile(workspaceId, path, scope?)` → `{ original, modified }` — both sides of one file's change for
  the center Monaco diff tab, each read through its side's explicit **`DiffSide`** union — `{kind:"ref"}`
  (a commit/branch, raw `git show ref:path`), `{kind:"index"}` (the staging area, `git show :<path>` — stage
  0, falling back to **stage 2** ("ours") for an unmerged path, which has no stage 0 at all: an empty index
  side there would render the file as an add-style or delete-style lie, which this surface must never do),
  `{kind:"worktree"}` (the file on disk), or `{kind:"empty"}` (nothing there — untracked/added, a renamed
  file's new path, or a root commit, degrading to an add-style diff). A union rather than `string | null`,
  because `null` previously meant *empty* on one side and *the worktree* on the other — two meanings for
  one value, and no room for the index, which the `staged`/`working-tree` scopes need. Both `showBlob` (a
  ref side) and `showIndexBlob` (the index side) treat a **read failure** as either an *expected absence*
  (the path genuinely isn't there — logged nowhere) or a broken read (index-lock contention, a bad ref,
  repo corruption — `console.warn`ed, because that failure must stay visible) through the **one shared
  predicate** `isExpectedAbsence(stderr)`, so the two can't drift into two regexes for one concept. The
  path is escape-checked against the worktree root before either side is read; **`listCommits(workspaceId)`** →
  `{ commits: GitCommit[] }` —
  `git log <diff base>..HEAD`, newest first and capped, one `--format` line per commit whose fields are separated
  by a **NUL byte** and read at **fixed arity** (the leading four positionally, everything after them joined back
  as the subject). NUL is the one byte the repository-controlled text cannot smuggle in: an author ident carries
  neither NUL nor newline, so no crafted `%an` can shift `%cI` or truncate itself, and a `%s` that carried one
  would land in the tail anyway. (`%an` is free text *between* the structured fields and the subject, which is
  why "structured fields first" was never enough — an author named `a<sep>2020-01-01T00:00:00Z` shifted the
  subject one field over.) Free-text fields are then stripped of control characters **and of invisible
  deception** — bidi overrides/isolates, zero-width and format characters — before they go on the wire, while
  ordinary international text and emoji survive;
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
  round-trip on its critical path (non-`origin/` ref / offline → no-op). Its result also says whether the
  fetch **`moved`** the local remote-tracking ref (first appearance included; compared on the
  fully-qualified `refs/remotes/…` — the exact ref a fetch updates — so a local branch literally named
  `origin/<b>` can't shadow the check via git's DWIM order): a moved ref *may* change what a sibling
  workspace's branch-scope diff means (its merge-base can move), and it is invisible to the `watch` module
  (the write lands in the project repo's shared `.git`, outside every watched location) — so the
  `git.prefetch` handler uses `moved` to fan out the host's pathless `fsChanged` nudge (`host`'s fsNudge
  seam; an unaffected re-read is an idempotent no-op). `moved` is host-internal; the wire response stays
  `{ ok }`.
- **Public surface (barrel):** `git`, `gitAsync`, `gitArgv`, `GitRunOptions`, `gitStatus`, `gitDiffFile`,
  `listCommits`, `resolveDiffRange`, `changedFileArgs`, `diffBaseRef`, `DiffRange`, `DiffSide`, `isSafeRef`,
  `assertSafeRef`, `listBranches`, `resolveDefaultBranch`, `currentBranch`, `prefetchBranch`.
- **Allowed deps:** `persistence` (workspace + project lookup); `contracts` (`Git*`/`BranchList` types);
  `@thinkrail/shared/codedError` (naming a failure for the wire); Bun (spawn).
- **Forbidden:** `host`; sibling features.

## Get right

- **A scope is defined once.** Any new read that has to know what "the diff" is goes through
  `resolveDiffRange` — never its own `git diff <base>` line — and any read of the base ref goes through
  `diffBaseRef`, so `diffBase ?? baseBranch` exists in exactly one place in the codebase.
- **An unrecognised scope kind resolves to the `branch` range, deliberately.** `resolveDiffRange` checks
  `working-tree`/`staged`/`commit` and falls through to `branch` for everything else — including a fifth
  kind a version-skewed client sends that this host predates. That fall-through is the intended behavior,
  not an accident of narrowing: a client ahead of its host must get a real diff back, never an error or a
  silently empty set, for a scope the host simply doesn't know yet.
- **A commit scope validates that the commit *exists*, not that it is still reachable** from the branch. A
  rebase or reset can rewrite history out from under a selection; the object is still there, and showing its
  diff is *more* useful than silently resetting the user to "All changes". Which commits are *offered* is the
  scope menu's job (`listCommits`), not the read's — so no read pays for a `merge-base --is-ancestor` pair.
- **A failed read is an error, never "no changes".** `gitStatus` (and its `--numstat` pass) honours the exit
  code: a diff that could not run throws, so the panel keeps its last good list and says the refresh failed
  instead of rendering an empty change set. The `workspaces` module's `diffStats` follows the same rule from
  the other end — it returns *no* stats (and logs why) rather than a fabricated `+0 −0`. A review surface that
  calls a dirty worktree clean is the worst failure this product can have.
- `gitStatus` reports the **live** current branch for a `kind: "default"` workspace (the project
  folder's branch moves out-of-band — a terminal `git checkout` — and the persisted snapshot self-heals
  only at list time; the Changes header must not lag).
- **Reads never take git's optional locks.** Every `git()`/`gitAsync()` invocation passes
  `--no-optional-locks`, unconditionally — `gitArgv` has no opt-out. A pi agent runs git concurrently in the
  same worktree, and a status read that refreshes the index as a side effect can lose a race for
  `.git/index.lock` — turning a healthy repo into a failed read. There is no writer in this repo that needs
  the flag gone (`init`/`add`/`commit`/`branch`/`worktree add` all succeed under it — the flag suppresses
  only *optional* locks, never a required one), so an opt-out would be speculative API with no caller.
- **A conflicted (unmerged) path is never doubled, and never silently blanked.** `gitStatus` dedupes
  `--name-status`'s output by path (git prints an unmerged path twice for `working-tree` scope); reading
  its index side falls back from stage 0 (absent for an unmerged path) to stage 2 ("ours") rather than
  reading as empty. A `pi` agent and the user both run `merge`/`rebase`/`cherry-pick`/`stash pop` in these
  worktrees, so an unmerged index is a normal state here, not an edge case — and this surface's one job is
  to never make a false claim about the working tree (see the top-of-file "Get right" entry above).
