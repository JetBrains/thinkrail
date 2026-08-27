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
- **Owns:** `git(cwd, args)` (spawn git *sync*, capture trimmed stdout/stderr + ok; `opts.raw` keeps
  stdout byte-exact for file-content reads) and `gitAsync(cwd,
  args, opts?)` (its async twin — off the event loop through `subprocess`' `runBounded`, for network-bound ops
  like `fetch` that must not block the host: it owns only the git-shaped part, the 55s budget (`opts.timeoutMs`
  overrides it) and the stalled/stderr wording, never the child-lifetime mechanics; `opts.env` lets a caller
  run prompt-free with its own environment, e.g. `pr`'s non-interactive push). **A timeout keeps whatever git
  wrote before the kill**: the runner drains continuously, so on expiry its `err` already holds the real
  diagnosis — a publickey rejection, a proxy's refusal, `remote:` progress proving a large transfer was simply
  still running. The ssh-key hint is what we say when git wrote *nothing*, never advice pasted over an
  observation we already have (the message never names a cause we did not observe);
  **`remoteTrackingRef(ref)`** → `refs/remotes/<ref>` for an `origin/` ref, else `null` — **the one place
  that spelling is built**, so the probe below and `workspaces`' `worktree add` cannot drift apart. Its
  reach is **creation only**, and `resolveDiffRange` is the named survivor: `diffBaseRef` hands git the
  `origin/<b>` shorthand recorded in `baseBranch`, so in the very setup create now guards against — a local
  branch literally named `origin/main` — the worktree is cut from `refs/remotes/origin/main` while the diff
  is measured against the decoy. Left alone because `diffBase` is separately user-settable and may name any
  ref, so qualifying it is a change to what a *pinned* base means, not a spelling fix;
  **`remoteRefOid(repoPath, ref)`** → the oid `refs/remotes/<ref>` resolves to, or `null` — **the one way
  to ask whether a remote-tracking ref is present**, shared by `prefetchBranch` (which compares oids to
  report `moved`), `resolveDefaultBranch`'s `origin/main` fallback, and `workspaces`' create fallback. It
  probes the **full** `refs/remotes/` path behind
  `--end-of-options`: the `origin/<b>` shorthand goes through git's disambiguation and can resolve to a
  tag or a local branch of that name, so the call sites would have raced over different objects. "One way"
  is literal — no caller re-spells the `rev-parse` by hand;
  **`nonInteractiveGitEnv()`** — the default environment both runners spawn under (`git`'s only option is
  `raw`; `gitAsync` alone accepts an `opts.env` override, e.g. `pr`'s non-interactive push, which layers its
  own SSH batch-mode settings): `process.env` plus `GIT_TERMINAL_PROMPT=0`, and **nothing else** by default.
  It reads no config and rewrites none of the user's ssh setup on its own;
  **the scope→range resolver** — `resolveDiffRange(ws, scope?)` → `DiffRange` — **the one definition of what
  a `GitDiffScope` means** (`branch`: `git diff <merge-base(base, HEAD)>` + untracked, sides = **fork
  point** ↔ worktree — what the workspace changed *since diverging*, so a base that advanced underneath it
  (a fetch moving `origin/main`, upstream work landing) never surfaces as phantom changes; while the base
  hasn't diverged the merge-base *is* its tip, and a failed `merge-base` (missing base, unrelated
  histories, unborn `HEAD`) falls back to the raw ref, keeping the old error surfaces — and keeping the
  file list ancestry-consistent with `listCommits`' `base..HEAD`;
  `uncommitted`: `git diff HEAD` + untracked, sides = `HEAD` ↔ worktree; `commit`: `git diff <sha>^ <sha>`, no
  untracked, both sides from history — a **root** commit degrades to `git show --format=` with an empty
  original, the same add-style degradation an absent path already gets; `pinned`: `git diff <oid>` +
  untracked, sides = the given immutable commit ↔ worktree — the review sidebar's base-side
  navigation, validated exactly like a `commit` sha, same `UNKNOWN_COMMIT` rejection). Both reads build their argv from it
  through `changedFileArgs(range, mode)`, so the file list and a file's two sides can never disagree on the
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
  it: the review's `baseSha`, a base-side comment's `baseRef`. A scope's
  `originalRef` is not already immutable (`uncommitted` is the literal `HEAD`; a `branch` scope degrades to
  the raw base ref when `merge-base` fails), so storing one verbatim lets the content move under whoever
  stored it;
  `gitStatus(workspaceId, scope?)` — changed files over the range plus untracked (only when the range ends at
  the worktree), each carrying per-file `added`/`removed` line counts (`git diff --numstat`, its rename-mangled paths resolved
  via `numstatPath` to match `--name-status`; binary rows dropped; untracked files count their whole
  content as added) for the Changes tree's `+/−` badges;
  `gitDiffFile(workspaceId, path, scope?)` → `{ original, modified }` — both sides of one file's change for
  the center Monaco diff tab (`original` = the file at the range's start ref, raw, empty when absent there —
  untracked/added, a renamed file's new path, or a root commit — degrading to an add-style diff; `modified` =
  the worktree file (empty when deleted) for a range ending there, else the commit's own tree; the path is
  escape-checked against the worktree root); **`listCommits(workspaceId)`** → `{ commits: GitCommit[] }` —
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
  other scopes; **`countUnpushedCommits(worktreePath, branch)`** (async — the sync twin would block the shared
  event loop on every window-focus refetch) → `rev-list --count origin/<branch>..HEAD` (local
  remote-tracking ref, no network), `null` when that ref doesn't exist (never pushed) — the host's
  `workspace.openReview` composes it onto an open review (in parallel with the gh lookup, not after
  it) so the plan page can flag commits the PR doesn't have yet; `listBranches(projectId)` → `{ local, remote,
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
  `git fetch` of a remote ref (via `gitAsync`), so a later `createWorkspace` branches off a fresh tip
  without the network round-trip on its critical path (non-`origin/` ref / offline → no-op). Its ref is
  **wire-supplied and passes the same `isSafeRef` gate `createWorkspace` uses** before it reaches git:
  `--` separates *options*, not refspecs, so `--`-after-`fetch` alone stopped a `-`-prefixed name and
  nothing else — `origin/+main:refs/heads/victim` would have arrived as a **refspec** and let any client
  force-overwrite or create arbitrary local branches in every open project (an unsafe ref → the same
  `{ ok: false, moved: false }` no-op, never a throw, because this path is fire-and-forget). Its result also says whether the
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
  render a base-side anchor's own content);
  **`gitCommitPaths(workspaceId, message, paths)`** → `{ sha } | null` — commit **exactly `paths`** as one
  commit for the TODO change-set feature (see [[submodule-server-todos]]): stage them (`git add -A --
  <paths>`, so a deletion stages as one), then `git commit --no-verify -- <paths>` (the host's commit must
  not run/fail the user's hooks; author/committer stay the user's git config — it's their branch), and
  return the new sha. **Only the named paths** — never "whatever is dirty now": the caller passes the set
  it proved belongs to the item (and, being its filtered delta, it never contains `.thinkrail/`), so dirt
  that appears between the caller's `gitStatus` and this call cannot be swept in, and the user's other
  staged work stays staged rather than riding along. The paths are **literal filenames, never pathspecs**:
  every path-consuming command runs `--literal-pathspecs`, so a tracked file whose *name* is pathspec
  magic or a glob (`:(top)*`) can't expand beyond the proved delta and defeat the exact-path guarantee or
  the `.thinkrail/` exclusion. **The index is preserved across failure:** the
  checkout's real index **file** (`rev-parse --git-path index` — per-worktree in a linked worktree) is
  snapshotted byte-for-byte before staging and written back on every failure path, so a skipped commit
  leaves the user's staging area exactly as it was — *including index-only state a tree round-trip would
  drop* (an intent-to-add entry from `git add -N` has no tree representation, so a `write-tree`/`read-tree`
  snapshot would silently unstage it). Staging succeeds but committing is fallible (an unset identity, an
  unavailable signing key), and a best-effort feature must not leave the user's next commit carrying files
  they never staged. An index with unmerged entries (a conflicted merge in flight) bails out untouched; a
  half-merged worktree is nothing to auto-commit anyway. Returns `null` for an empty path set, when those paths had nothing to commit
  (`git diff --cached --quiet -- <paths>`), or on any git failure — the caller (`todos/artifacts`) treats
  that as "fall back to path-list artifacts" and never lets it throw. It is the one git primitive that
  **writes** the user's branch; the caller serializes it per workspace.
  **`gitHeadSha(workspaceId)`** → `string | null` — `rev-parse HEAD` (`null` on an unborn HEAD), recorded
  into the todos baseline sidecar at `in_progress`.
- **Public surface (barrel):** `git`, `gitAsync`, `nonInteractiveGitEnv`, `remoteRefOid`, `remoteTrackingRef`, `gitStatus`, `gitDiffFile`,
  `readBlobAt`,
  `gitCommitPaths`, `gitHeadSha`, `listCommits`,
  `resolveDiffRange`, `changedFileArgs`, `diffBaseRef`, `resolveCommitOid`, `DiffRange`, `isSafeRef`,
  `assertSafeRef`, `listBranches`, `resolveDefaultBranch`, `tryCurrentBranch`, `currentBranch`,
  `canonicalPath`, `prefetchBranch`.
- **Allowed deps:** `persistence` (workspace + project lookup), `log`; `contracts` (`Git*`/`BranchList` types);
  `subprocess` (`runBounded`, the bounded child behind `gitAsync`);
  `@thinkrail/shared/codedError` (naming a failure for the wire); Bun (spawn, for the sync runner).
- **Forbidden:** `host`; sibling features.

## Get right

- **A scope is defined once.** Any new read that has to know what "the diff" is goes through
  `resolveDiffRange` — never its own `git diff <base>` line — and any read of the base ref goes through
  `diffBaseRef`, so `diffBase ?? baseBranch` exists in exactly one place in the codebase.
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
- **A network git call is bounded by us, not talked out of waiting.** A `fetch` whose remote wants a
  passphrase blocks on `/dev/tty` forever, and the only thing that ever ended that wait was the *client's*
  60s request timeout (`transport.ts` `DEFAULT_TIMEOUT_MS`, not overridden for `workspace.create`) — which
  by construction carries no cause, so the user got `request "workspace.create" timed out` (issue #209).
  `gitAsync` therefore races the child against a **55s budget** (`opts.timeoutMs` overrides; the tests
  drive it at 500ms): on expiry it kills the child and resolves with `timed out after <actual>s — the
  remote never answered`, which `workspaces` carries into the create failure.
  **The budget is set as high as the client's 60s allows, on purpose.** Any budget below the client's turns
  a *slow but healthy* operation that used to finish into a hard failure — the first fetch of a large
  repository over a slow link is the real case. That window is **not closed, only narrowed** to roughly
  55–58s, and it cannot be closed: a budget at or above the client's would hand the race back to the
  causeless `request … timed out` this bullet exists to remove. The remaining ~5s is what the throw needs
  to travel back and still beat the client; if a blocked loop overshoots it, the client's generic timeout
  fires — the pre-fix behaviour, a degradation rather than a new failure. The ordering itself is **pinned
  by nothing**: `transport.ts`'s 60s and this 55s are hand-kept numbers in two independently-shipped
  artifacts, correct by agreement rather than by construction. Deriving one from the other belongs in
  `contracts`, and is deliberately out of this change's scope.
  **The message never names a cause we did not observe.** All we know on expiry is that the remote did not
  answer; an unloaded SSH key is offered as *a* likely cause, conditional on the remote using SSH, because
  asserting it outright mis-diagnosed every `https://` stall and every slow-link fetch as an auth problem.
  Elapsed seconds are floored at 1: `Math.round` renders a sub-500ms wait as `0s`, which reads as a bug.
  **It is a lower bound, not a ceiling.** `setTimeout` cannot fire while the loop is blocked, and the
  *sync* runner blocks it by design (`Bun.spawnSync`), so the real wait is the budget plus whatever
  sibling `git()` calls hold the loop for — measured at 6× the budget under a deliberate storm. Hence the
  message reports the **elapsed** time rather than the configured budget: the number the user reads is
  never a fiction. Closing the gap would mean moving git off the loop entirely, which this ticket does not
  buy. The timer is `unref`'d: it exists to *bound* a wait, so it must never itself be the reason the host
  stays alive — an in-flight fire-and-forget `prefetchBranch` would otherwise hold shutdown open for up to
  the full budget.
  **`boundedStderr` cuts the middle, not the tail.** git's own words are always last, and a tail cut hid
  them: `git.ts`'s `exists on disk, but not in` probe sits *after* the path, so losing it turned an
  ordinary miss into a `console.warn` storm. Residual, unfixed, and inherent to any fixed-size cut — a
  message long enough to push that phrase into the elided middle (a ~2000-character path *and* a
  ~800-character ref) still loses it, and moving the head/tail split only moves the window.
  **The wait ends when git exits, not when git's pipes do.** That distinction is `subprocess`'
  (`runBounded`) to keep, and getting it wrong inverted this feature: a grandchild `ssh` — a
  `ControlMaster`, a credential-cache daemon, a corporate wrapper — inherits `stderr` and outlives git, so
  reading to EOF never returns *even when the fetch succeeded*. With the read as the completion signal, a
  fetch that finished in milliseconds was reported as a full-budget authentication failure.
  Verified both ways by `gitExec.test.ts`: a `core.sshCommand` that backgrounds a stderr-holding child and
  exits 0 yields git's own `Could not read from remote repository` in well under a second, and yielded the
  stalled message after the full budget before the fix.
- **We never touch the user's ssh client — that was tried and withdrawn.** Appending `-o BatchMode=yes` to
  their effective ssh command (`GIT_SSH_COMMAND`, else `core.sshCommand`, else `ssh`) fixes #209 for the
  common setup, and cannot be made safe. Two of its failures are unfixable
  in principle, not merely unfixed: `BatchMode` suppresses `SSH_ASKPASS`, so every user whose desktop
  passphrase dialog *worked* loses it — the dialog **is** a wait for a human, so forbidding the wait
  forbids the dialog; and delivering a *per-repo* option through `GIT_SSH_COMMAND`, a *process*-scoped
  variable that outranks `core.sshCommand`, inverts priority for every other repo touched under that env —
  a submodule with its own deploy key gets the parent's client. Four further defects followed from having to
  rewrite a command we must first parse the way git does (`split_cmdline`) — a quoted plink path slipping the
  non-OpenSSH bail-out, corporate wrappers rejecting the `-o`, `GIT_SSH` bailing out with the hang left
  unfixed, and a `spawnSync` config read per `git()`. The budget above needs none of it: it is blind to which
  ssh client, which variant, which wrapper, and whether an askpass exists.
- **The env layers over `process.env`, never replaces it.** `boot`'s `resolveShellEnv()` repairs `PATH`/`LANG`
  by *mutating* `process.env`; a bare env object would drop that repair and `SSH_AUTH_SOCK` with it, and a
  live agent socket is what lets the user who did load their key fetch without any prompt at all.
