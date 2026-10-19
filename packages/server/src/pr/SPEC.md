---
id: submodule-server-pr
type: submodule-design
status: draft
title: pr — push the workspace branch, open/update its GitHub PR, and act on it
parent: module-server
depends-on: [submodule-server-branch-review, submodule-server-todos, submodule-server-github]
implements: [task-open-pr]
tags: [github, pull-request, public-surface-checked]
---

## Responsibility

The deterministic host side of "plan done → PR open" (`pr.open`): push the workspace branch to
`origin` and open — or update — the branch's GitHub PR, with the PR body rendered from the session's
TODO plan (the verified-plan narrative: summary, steps with sha + verification, review trail). The
body also carries a **`## Committed outside the plan`** section for `TodoPlan.adoptedCommits` (branch
commits no step owns — see [[submodule-server-todos]]) and the review trail spans planned steps **and**
adopted commits, so a branch whose work never entered the plan still ships a non-empty, honest
description instead of a blank body. The
button never routes through the agent (a prompt-backed PR button is fragile — see task-open-pr); a
future pi extension exposes the same library to the agent.

## Behavior

`previewPr({ workspaceId, sessionId?, title?, source?, template? })` → `{ title, body, templates,
planAvailable, source }` (`pr.preview`): the exact title/body `openPr` would use, so the client's compose
dialog can offer them for editing before anything is pushed. `source` picks the body: **`plan`**
(`renderPrBody` over the session's wire plan, adopted commits included — the default whenever that plan
has items; `planAvailable` reports whether it renders anything at all), **`commits`** (the subjects of `<base>..HEAD`, oldest first, as a
bullet list — the default otherwise, so a plan-less or empty-plan PR still gets an honest body; `host`
asks for `plan` explicitly on a session-backed preview from a pre-v87 client, which only ever saw the plan
body), **`template`** (the chosen discovered template verbatim; the first one
when `template` is absent), or **`empty`**. **Template discovery** reads the worktree, not the forge:
GitHub's `pull_request_template.md` in `.github/`, the root, or `docs/` (any case) and every
`.github/PULL_REQUEST_TEMPLATE/*.md`, plus GitLab's `.gitlab/merge_request_templates/*.md`; paths are
worktree-relative, size-capped, and contained (the real path of each file, symlinks resolved, must sit
inside the real worktree), and listed in that order.

`prDraftInput({ workspaceId, sessionId?, template? })` → the bounded input `assist.suggestPrDescription`
drafts from (`pr.generate`, composed in `host`): branch + base, commit subjects, `git diff --stat` against
the base clamped to a fixed line budget, the session plan's rendered body when present, and the chosen
template's text.

`pushBranch({ workspaceId, branch, confirmBase? })` → `{ dirtyFiles }` (`workspace.push`): the safe-ref guard
and `refreshUserOwnedWorkspace` revalidation before and after the dirty read — each time the live branch must
still be the `branch` the request names (the one the user saw and confirmed), so a terminal switch in between
pushes nothing instead of another branch — then the same `--set-upstream origin <branch>` push, env, and
`PUSH_AUTH_FAILED` classification as step 2 below — one implementation that `openPr` also calls. A branch
that IS its base is refused unless `confirmBase` is set (the client confirms first, naming the shared
branch); it never reads, edits, or creates a PR, and drops the worktree's review cache like every push.

`openPr({ workspaceId, sessionId?, title?, body?, draft? })` (`sessionId` only matters when `body` is
absent: a session's PR is then refreshed from its plan body — source `plan` explicitly, never the
preview default — so *Push updates* keeps a plan of adopted commits only in its structured form), one call =
one idempotent attempt
(`body` — the user-edited description from that dialog — replaces the rendered plan body verbatim
when present; the title/body defaults come from ONE place — openPr consumes `previewPr`, so the
previewed draft and the pushed PR can never diverge). The call opens with **`assertSafeRef(ws.branch)`**:
adopted/external worktree branches are stored verbatim from git (only created workspaces pass
`toBranch`), so an option-shaped branch from an untrusted repo (`--repo=x` is creatable via
`git update-ref`) must be rejected before it reaches any git/gh argv. It then rejects a **non-origin
remote base before the dirty-file read or push**: it pushes and opens against `origin` only; silently treating
`upstream/main` as a branch in that repository would first publish the workspace branch and only later
fail to identify its PR target. A remote-tracking ref that outlived its remote configuration is rejected
on the same side. The error directs the user to open it manually or create from a local/`origin` base;
cross-repository fork PR creation is future scope, not guessed from string prefixes.
The next guard rejects when the branch **IS its base** (`ws.branch === baseRef(ws.baseBranch)`, still
before the origin check or any push): the Default workspace's cwd is the project's own checkout, so
`branch`/`baseBranch` commonly coincide whenever the user is on the repository's default branch
(`workspaces`' `folderTruth` tracks both off the live `git symbolic-ref`), and an external (adopted)
workspace can equally sit on its base — without this guard, Open PR would `git push origin
<default-branch>` straight to the shared branch on an unprotected remote, publishing the commits before
any PR could offer its review boundary. The client mirrors the ordinary local/`origin` same-branch case;
the host remains authoritative for unsupported remote bases. **`refreshUserOwnedWorkspace(workspaceId)` resolves the LIVE branch for
Default/external workspaces** (`workspaces`' same sync used by the fs-watcher tee) and persists it — a
no-op for created workspaces, whose branch only ThinkRail ever moves. Open PR validates once before its
async dirty-file read (preserving the safe base-branch fast failure), then refreshes, reloads, and
revalidates immediately after that await. Without both, a branch switched in a terminal while the Git
read is in flight or moments before pressing Open PR would push/open/compare against the STALE persisted
branch until the async watcher next catches up: the branch-sensitive `ws` is fresh, so the
base guard, the push, the `gh` lookup/create, and the compare URL all derive from the one refreshed
value. When the request names a `branch` (the branch the client composed the draft for), both refreshes
must still see it live, exactly like `pushBranch`: a checkout moved between composing and submitting
pushes nothing rather than opening a PR for another branch with this one's title and body. Then:
1. No `origin` remote → throws (the client toasts it). The forge (GitHub slug / GitLab project) is read from
   origin's **configured push URL** (`remote.origin.pushurl`, else `remote.origin.url`, via `git`'s
   `originUrls`), not the fetch URL, so a remote that pushes elsewhere than it fetches opens the review
   where the branch actually landed; `insteadOf` rewrites are not expanded, since they map transports for
   the same host. Push failure → throws with git's stderr;
   a stderr matching the non-interactive-auth signatures (`Permission denied (publickey)`,
   `could not read Username/Password`, `Authentication failed`, `terminal prompts disabled`,
   `Host key verification failed` — `isPushAuthFailure`) throws `CodedError("PUSH_AUTH_FAILED")`
   instead: the host pushes without a terminal, so git's credential prompts can never appear, and
   the client answers with setup guidance rather than a raw-stderr toast.
2. Always pushes `--set-upstream origin <branch>` first — the branch is workspace-owned, so a plain
   push is correct; re-invocations push follow-up commits to the SAME branch (never a second PR).
   The push runs with a **non-interactive env** (`pushGitEnv`): `GIT_TERMINAL_PROMPT=0`;
   **`LC_MESSAGES=C` with `LC_ALL` demoted to `LC_CTYPE`** (dropped, its value preserved as
   `LC_CTYPE` when none was set) so git's stderr stays English for the PUSH_AUTH_FAILED patterns on
   any host locale — while hooks and helpers spawned by the push keep their character encoding
   (`LC_ALL=C` would flip Python-based pre-push hooks into ASCII mode; dropping an
   LC_ALL-only locale entirely would do the same via a POSIX `LC_CTYPE`); and `GIT_SSH_COMMAND=ssh -oBatchMode=yes` — but ONLY when the user has no ssh command of
   their own (`GIT_SSH_COMMAND`/`GIT_SSH` env or **`core.sshCommand` git config** — the env var
   overrides the config, so setting it blindly would break a working custom-key/1Password setup and
   misreport it as an auth failure). When the host has a controlling tty, ssh would otherwise prompt
   for a key passphrase on `/dev/tty` and hang the whole call until the client times out — batch
   mode turns that hang into the immediate `Permission denied` the classification is built for.
3. GitLab.com origin → `action: "compare"` with GitLab's prefilled new-MR page (`gitlabNewMrUrl`: source,
   target, title, description capped like the GitHub compare body) — no `glab` mutation this iteration. Any
   other origin (incl. local/bare test remotes) → `action: "pushed"` — the honest floor.
4. GitHub origin: every `gh` call carries `--repo <slug>`, the push URL's repository — gh would otherwise
   resolve the repository from the remote's fetch URL, so a split origin would look up, edit, or create the
   PR on the repository that never received the branch. An existing open PR (`gh pr list --head <branch>
   --base <input.base>`, parsed by
   `branch-review`'s `reviewNumber`) → `gh pr edit <NUMBER> --title --body` refresh → `action: "updated"` +
   **`bodyRefreshed`** (an edit failure is reported, never claimed as success). The edit selector is
   the NUMBER the list step just returned, never the branch positional — gh resolves a numeric
   branch name ("1234") as a PR number, which would rewrite a stranger's PR — and `--title` rides
   along **only when the client marked it edited** (`titleEdited`): the compose prefill is
   regenerated from the plan, not read from the live PR, so an untouched title must never clobber a
   rename made on github.com. The list step filters by **both `--head` and `--base`** — a bare `--head`
   would match ANY open PR from that branch regardless of target (the same head can have two open PRs
   to different bases), editing/reporting on a wholly unrelated PR instead of this workspace's; none →
   `gh pr create --base <ws.baseBranch minus origin/>` → `action: "created"`
   + `{ review, url }` parsed from gh's output. **`--base` is always explicit** (`baseRef`, the same
   normalization the compare URL uses): without it gh targets branch config or the repository
   default branch, so a workspace created from `release/x` would open its PR against `main`. **Mutating gh calls run with a 60s timeout** (the
   shared runner's 8s default fits read-only lookups only — killing a mutation mid-flight is how
   duplicate PRs happen), and a failed/ambiguous `create` is followed by a **re-check** (`gh pr
   list` again): if the PR exists server-side despite the error, it is returned as `created` —
   never the compare fallback, which would invite a duplicate.
5. `gh` missing/unauthenticated/failed, or `THINKRAIL_GH_OFFLINE=1` (the e2e seam shared with the
   `github` module) → `action: "compare"` + a prefilled `quick_pull` compare URL (title + body,
   body capped at 4k for URL-length safety) — the zero-auth fallback the client opens in a browser.
   When `github`'s `ghSetupProblem()` can name why (`missing` / `unauthenticated`), the result
   carries it as **`ghProblem`** so the client shows setup guidance instead of a bare compare
   hand-off. The probe runs **only after the gh flow actually failed** (never on the happy path —
   `gh auth status` is a network round-trip, and a gh that *works* but reports oddly, e.g. a stale
   second-host token, must never get its one-click path skipped) and it is **async with an 8s
   kill** — the in-process host shares one event loop, a synchronous probe would freeze every
   session. A probe that finds gh installed + authed (a transient flow failure) and the offline
   seam stay unnamed — the silent compare fallback remains.
6. Every result carries `dirtyFiles` (uncommitted-change count) so the client can warn that those
   won't be in the PR. Dirty state never blocks. The server-side `openPr` result also carries the exact
   refreshed `branch` used for push/gh/compare; the host CASes the review snapshot against that branch and
   strips it before the wire response. Capturing branch before the dirty-read await is unsound for
   user-owned checkouts because `openPr` deliberately refreshes after that await.

**Review actions** (`reviewActions.ts`, v87): `readyPr` (`pr.ready`), `reopenPr` (`pr.reopen`),
`mergePr({ …, method, deleteBranch })` (`pr.merge`) and `deleteRemoteBranch` (`workspace.deleteRemoteBranch`).
Every PR mutation is bound to what the user saw: the refreshed live branch must still be the request's
`branch` (a terminal switch changes nothing) and must not be its own base, and `gh pr view <number>`
must still show that number heading this branch **from origin's own repository** (`headRepositoryOwner`
/ `headRepository` against the slug of origin's push URL) in the state the action needs (open for
ready/merge, closed for reopen). `gh pr list --head` matches by branch name alone, so a fork's PR from a
same-named branch (`contributor:main`, `patch-1`) is otherwise indistinguishable — and the base-branch
refusal keeps the Default workspace on `main` from ever acting on one. The merge passes
**`--match-head-commit <HEAD>`** so GitHub merges exactly the head the user looked at (the client offers
Merge only while the branch matches origin), then re-reads the PR: `gh pr merge` also exits 0 when a merge
queue or auto-merge only **queued** it, so `MergePrResult.merged` reports the state GitHub shows and the
branch is deleted only after a real merge — deleting a queued PR's head branch would close it. Mutations run under the 60 s timeout through
the injected runner, surface gh's stderr when refused, and drop the worktree's review cache whatever the
outcome. **The remote branch is deleted with git, never `gh pr merge --delete-branch`**: gh would also
delete the local branch and switch the checkout — fatal for a worktree and for the user's own checkout.
Both paths run `git push origin --delete refs/heads/<branch>` (the full ref, so a same-named tag is never
the one deleted) through `pushOrigin`, the one push helper (`pushGitEnv` + `PUSH_AUTH_FAILED`)
`pushToOrigin` also uses; an already-missing remote branch counts as deleted (GitHub's own auto-delete may
have won). After a successful merge a failed deletion is reported in `MergePrResult.deleteError`, not
thrown. The standalone deletion refuses the base branch, a branch whose review the fresh lookup reports
open, and — when that lookup did not answer — any branch at all, since deleting a PR's head branch closes
it and an unanswered lookup cannot rule that out.

The open-PR *read* side stays `workspace.branchStatus` / `workspace.openReview` (`branch-review`) — this module persists
nothing; the client re-derives button/chip state from that lookup plus this call's result. That
lookup is cached, so every successful push drops the worktree's prior answer: pushing may change the
branch's remote configuration even when the remote is not GitHub or the action falls back to compare.
A GitHub mutation attempt drops it again after settlement, so a concurrent "no PR" read cannot survive
an update, a create, or an ambiguous create result.

## Boundary

- **Owns:** the push (with or without a PR) + PR action, the GitHub review mutations (ready, merge,
  reopen) and remote-branch deletion, PR-body rendering from the wire plan, commit and template body
  sources, PR/MR template discovery, the generation input, GitHub slug/compare-URL derivation.
- **Public surface (barrel):** `openPr`, `previewPr`, `pushBranch`, `prDraftInput`, `onBaseBranch`,
  `readyPr`, `mergePr`, `reopenPr`, `deleteRemoteBranch`.
- `onBaseBranch` is the one "the branch is its own base" check, shared with `host`'s
  `workspace.branchStatus`.
- **Allowed deps:** `workspaces` (workspace record, `refreshUserOwnedWorkspace`), `git` (exec + status), `todos` (`listTodos` for
  the body), `branch-review` (provider detection, `githubSlug`, existing-PR lookup, the fresh open-review
  check before a remote deletion, the shared command runner, `forgetOpenBranchReview`),
  `github` (`ghSetupProblem` — the named compare-fallback reason); `contracts` types;
  `shared/codedError` (`PUSH_AUTH_FAILED`).
- **Forbidden:** `host`; provider HTTP APIs or stored tokens (auth stays external — the user's `gh`
  only); persisting PR state (that would duplicate `workspace.openReview`'s derivation).
- All `gh` traffic flows through one injected `PrCommandRunner` so unit tests never spawn a real CLI.
