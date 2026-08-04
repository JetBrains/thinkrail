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
  stdout byte-exact for file-content reads) and `gitAsync(cwd, args, opts)` (its async twin — `Bun.spawn`, off
  the event loop, for network-bound ops like `fetch` that must not block the host; `opts.timeoutMs` kills the
  child on a deadline instead of letting a hung network call run forever, `opts.env` merges over
  `process.env` — never replaces it — so a caller can add `REMOTE_ENV` without stripping `PATH`/`HOME`/
  `SSH_AUTH_SOCK`; still no `raw`, since byte-exact reads stay on the sync runner) plus **`REMOTE_ENV`**, the
  no-prompt environment a *background* remote call runs under (see Get right) — both runners route their argv
  through **`gitArgv(cwd, args)`**, extracted (and exported) so the flag
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
  | `pinned` | `diff <oid>` | yes | pinned commit | worktree |
  | `commit` | `diff <sha>^ <sha>` / `show` for a root | no | parent / empty | `sha` |

  `branch`'s merge-base ref is the **fork point** of the diff base and `HEAD` — what the workspace changed
  *since diverging*, so a base that advanced underneath it (a fetch moving `origin/main`, upstream work
  landing) never surfaces as phantom changes; while the base hasn't diverged the merge-base *is* its tip,
  and a failed `merge-base` (missing base, unrelated histories, unborn `HEAD`) falls back to the raw ref,
  keeping the old error surfaces — and keeping the file list ancestry-consistent with `listCommits`'
  `base..HEAD`. `working-tree` and `staged` split what a single conflated `uncommitted` scope used to lump
  together, now that the index is a real `DiffSide`: `working-tree` is what you have not staged yet (index vs
  worktree, plus untracked — nothing staged belongs here), `staged` is what a commit would record right now
  (`HEAD` vs the index, no untracked — untracked is by definition not staged). `pinned` is the review
  sidebar's base-side navigation — one IMMUTABLE commit (validated exactly like a `commit` scope's sha, same
  `UNKNOWN_COMMIT` rejection) against the worktree, untracked included: the anchor's own pinned oid, never
  whatever `branch` resolves to today. A **root** `commit` degrades to `git show
  --format=` with an empty original, the same add-style degradation an absent path already gets. Both reads
  build their argv from it through `changedFileArgs(range, mode)`, so the file list and a file's two sides can never disagree on the
  range — and that argv brackets its revs on **both** sides: **`--end-of-options`** ahead of them (no ref can be
  re-parsed as a git option) and a trailing **`--`** after them (a rev that also names a path on disk — a branch
  called `docs` — is read as a rev instead of failing the command as an "ambiguous argument"). A **failed**
  `git diff`/`git show` **throws**; it is never reported as an empty change set (see Get right). A `commit` scope's `sha` is validated **twice** — shape (hex-oid regex, so a crafted value can never
  reach a git argument as an option or a path) then existence (`rev-parse --verify`, whose full oid is what is
  then used) — and a vanished commit throws a **`CodedError("UNKNOWN_COMMIT")`** (`@thinkrail/shared/codedError`),
  which the host puts on the wire as `WsResponse.errorCode` and the client turns into "reset the scope, with a
  toast" — *only* for that named failure, never for a timeout or an unnamed host failure;
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
  **`resolveCommitOid(worktreePath, ref)`** — the full commit oid a ref names right now, or `null`. The one
  place a symbolic ref is FROZEN, and every caller that must still mean the same thing later goes through
  it: the review's `baseSha`, a base-side comment's `baseRef`. A scope's original side is not already
  immutable (`staged`'s is the literal `HEAD`; a `branch` scope's degrades to the raw base ref when
  `merge-base` fails), so storing one verbatim lets the content move under whoever stored it;
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
  side there would render the file as an add-style or delete-style lie, which this surface must never do —
  and if stage 2 is itself absent too, e.g. a modify/delete conflict where *our* side deleted the file, that
  retry's own failure is *also* an expected absence, not a broken read, so the index side degrades to empty
  silently rather than warning), `{kind:"worktree"}` (the file on disk), or `{kind:"empty"}` (nothing there —
  untracked/added, a renamed file's new path, or a root commit, degrading to an add-style diff). A union
  rather than `string | null`, because `null` previously meant *empty* on one side and *the worktree* on the
  other — two meanings for one value, and no room for the index, which the `staged`/`working-tree` scopes
  need. Both `showBlob` (a ref side) and `showIndexBlob` (the index side) treat a **read failure** as either
  an *expected absence* (the path genuinely isn't there — logged nowhere) or a broken read (index-lock
  contention, a bad ref, repo corruption — `console.warn`ed, because that failure must stay visible) through
  the **one shared predicate** `isExpectedAbsence(stderr)` — its "not at stage" clause names *any* stage
  digit, not just 0, because `showIndexBlob`'s stage-2 retry can fail with that same message shape at a
  different digit — so the two reads can't drift into two regexes for one concept. The
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
  module for a user-owned workspace's folder-truth `branch`, with **`tryCurrentBranch`** its fallible form
  (`null` when the path is not a readable worktree root, so a refresh never persists an I/O failure as a
  detach); **`canonicalPath(path)`** — the symlink-resolved form any path compared against git output must
  take (git resolves symlinks, a caller's path does not), shared with `workspaces`' worktree-identity
  checks; `prefetchBranch(projectId, ref)` — best-effort background
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
  `{ ok }`;
  **`readBlobAt(worktreePath, ref, path)`** → the file's byte-exact content at a ref, or `null` when the
  read produced none (the diff sides degrade that to `""`; the `reviews` module uses it to capture and
  render a base-side anchor's own content).
- `original` / `modified`: the two sides of the diff as an explicit **`DiffSide`** union — `{kind:"ref"}`
  (a commit/branch), `{kind:"index"}` (the staging area, read as `git show :<path>`),
  `{kind:"worktree"}` (the file on disk), or `{kind:"empty"}` (nothing there — a root commit's
  add-style diff). A union rather than `string | null`, because `null` previously meant *empty* on one
  side and *the worktree* on the other, and neither meaning left room for the index.
- **`remoteRefs.ts`** — the two remote operations and the local counting that interprets them.
  `probeRemoteRefs` runs `git ls-remote --heads <remote> <refs…>`: it **writes nothing** — no objects, no
  refs, no `FETCH_HEAD`, no ref locks, no gc trigger — and answers only *whether* a ref differs, never by
  how much. `fetchRemoteRefs` is the opt-in real fetch and reports which refs moved. `behindCount` is a
  purely local `rev-list --count`. Both remote calls run under `REMOTE_ENV` with a deadline, pass
  `-c maintenance.auto=false -c gc.auto=0` so a fetch cannot trigger background repacking, and **never**
  pass `--prune`: pruning can delete a remote-tracking ref a workspace is pinned to. `probeRemoteRefs`
  passes the requested refs as `ls-remote` **patterns** so the filtering happens server-side (protocol v2),
  and parses `<sha>\trefs/heads/<name>` rows into `heads` keyed by the short name; a failed read answers
  `{ ok: false, heads: {}, err }`, never an empty-but-`ok` result. `fetchRemoteRefs` reads each requested
  ref's **fully-qualified** `refs/remotes/<remote>/<name>` before and after the fetch — never the short
  name — because a local branch literally named `origin/<b>` would otherwise shadow the remote-tracking ref
  via git's DWIM resolution order (`prefetchBranch`, above, hits the identical hazard and documents it the
  same way); the ref names whose oid changed (first appearance counts) come back as `moved`. Neither remote
  call ever passes `--tags`, for the same pinned-ref reason as `--prune`. `behindCount(repoPath, from, to)`
  is `rev-list --count --end-of-options <from>..<to>`, purely local — it returns **`null`, not `0`**, when
  the range fails to resolve (e.g. one side doesn't exist locally, which is exactly the state a probe alone
  leaves the caller in): an unknown count is not "up to date", and the UI renders the two differently, so
  collapsing the distinction here would falsify the indicator two layers up. `remoteUrlKind(repoPath,
  remote)` reads `git remote get-url` and classifies `ssh://…`, `git@host:path`, and `user@host:path` (any
  `user@host:path` with no `://` scheme and no slash before the first colon — git's own scp-like-syntax
  rule) as `"ssh"`, anything else resolvable as `"other"`, and an unreadable/missing remote as `"unknown"`.
  `sshAgentPresent()` reads `SSH_AUTH_SOCK`, answering `false` only for an unset/empty value —
  deliberately **not** special-cased for the plain macOS launchd socket (`.../com.apple.launchd.*/
  Listeners`): that socket is a real, protocol-compliant agent (the Secure Keychain agent) that can hold
  keys added via `ssh-add --apple-use-keychain` and answer agent requests, so treating its mere presence as
  "no agent" would invert the safety direction this check exists for — a background op skipped because an
  agent *might* be listening is a convenience cost; a Keychain/Touch ID prompt surfacing during an
  unattended probe is the failure the whole ladder exists to prevent.
- **Public surface (barrel):** `git`, `gitAsync`, `REMOTE_ENV`, `gitArgv`, `GitRunOptions`, `gitStatus`,
  `gitDiffFile`, `readBlobAt`, `listCommits`, `resolveDiffRange`, `changedFileArgs`, `diffBaseRef`,
  `resolveCommitOid`, `DiffRange`, `DiffSide`, `isSafeRef`, `assertSafeRef`, `listBranches`,
  `resolveDefaultBranch`, `tryCurrentBranch`, `currentBranch`, `canonicalPath`, `prefetchBranch`,
  `probeRemoteRefs`, `fetchRemoteRefs`, `behindCount`, `remoteUrlKind`, `sshAgentPresent`.
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
- `gitStatus` reports the **live** current branch for a user-owned (`kind: "default" | "external"`)
  workspace (its branch moves out-of-band — a terminal `git checkout` — and the persisted snapshot
  self-heals only at list time; the Changes header must not lag).
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
  to never make a false claim about the working tree (see the top-of-file "Get right" entry above). The
  stage-2 retry can itself have nothing to read — a modify/delete conflict where *our* side deleted the file
  has no stage 2 either — and that is a genuine absence, not a broken read: it degrades to an empty index
  side, like every other expected absence, never a `console.warn`.
- **A network-bound git call has a deadline.** `gitAsync` takes `timeoutMs` and kills the child when it
  expires, resolving a normal failure rather than throwing. Without it a hung fetch or probe against an
  unreachable remote runs until the host exits, and the scheduler that called it never gets its slot back.
  The kill targets the whole **process group**, not just the immediate pid (which is why a deadlined call
  is spawned `detached`): git's http transport forks a `git-remote-http` helper that inherits the
  stdout/stderr pipes, and signalling only the top `git` process — verified empirically against a
  black-holed address — leaves that helper running and the pipes open, so the read side hangs forever even
  though the "killed" child is gone. A call with no deadline stays in the host's own group (unchanged
  behavior; nothing there ever kills it anyway).
- **A background remote call cannot prompt.** `REMOTE_ENV` sets `GIT_TERMINAL_PROMPT=0`, an empty
  `GIT_ASKPASS`/`SSH_ASKPASS`, and `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new"`.
  It removes the *git-level* prompt paths only: the OS keychain and hardware-backed keys sit below git and
  can still prompt, which is why `remotes` additionally refuses to touch SSH remotes when an agent is
  present. `accept-new` is load-bearing, not decoration: `BatchMode=yes` alone fails **closed** on an
  unknown host key (batch mode suppresses the prompt, it does not accept the key), so without it the very
  first background connection to any new host would fail — and the feature would silently never work for
  that user. A future simplification back to bare `BatchMode=yes` would reintroduce that failure with no
  warning anywhere.
- **The default background remote op writes nothing, on purpose — that is a safety guarantee, not an
  optimisation.** `probeRemoteRefs` is `ls-remote`, never a `fetch`: a background fetch would move
  `refs/remotes/*` (and `@{upstream}`) mid-session, which **silently defeats `git push --force-with-lease`**
  (per git's own docs) and could point a user's `git rebase @{u}` at a commit they never saw — and this app
  hands the user real terminals inside these worktrees, so that is not a hypothetical. A real fetch
  (`fetchRemoteRefs`) is therefore opt-in, never triggered on a bare background timer. Consequence: a probe
  can tell the caller *that* a ref moved but never *by how much* (the objects aren't local), so
  `behindCount` reads 0 right after a probe — this is why the UI's indicator has two modes (a bare `↓` for
  "moved, count unknown" vs `↓·N` only once a real fetch made the count answerable), not a bug in either
  layer. Neither remote call ever passes `--prune` or `--tags`: pruning can delete a remote-tracking ref a
  workspace is pinned to, and this module has no use for tags at all.
