---
id: submodule-server-pr
type: submodule-design
status: draft
title: pr — push the workspace branch and open/update its GitHub PR
parent: module-server
depends-on: [submodule-server-branch-review, submodule-server-todos, submodule-server-github]
implements: [task-open-pr]
tags: [github, pull-request, v1, public-surface-checked]
---

## Responsibility

The deterministic host side of "plan done → PR open" (`pr.open`): push the workspace branch to
`origin` and open — or update — the branch's GitHub PR, with the PR body rendered from the session's
TODO plan (the verified-plan narrative: summary, steps with sha + verification, review trail). The
button never routes through the agent (a prompt-backed PR button is fragile — see task-open-pr); a
future pi extension exposes the same library to the agent.

## Behavior

`previewPr({ workspaceId, sessionId, title? })` → `{ title, body }` (`pr.preview`): the exact
title/body `openPr` would use (chat title falling back to the branch; `renderPrBody` over the wire
plan), so the client's compose dialog can offer them for editing before anything is pushed.

`openPr({ workspaceId, sessionId, title?, body?, draft? })`, one call = one idempotent attempt
(`body` — the user-edited description from that dialog — replaces the rendered plan body verbatim
when present; the title/body defaults come from ONE place — openPr consumes `previewPr`, so the
previewed draft and the pushed PR can never diverge). The call opens with **`assertSafeRef(ws.branch)`**:
adopted/external worktree branches are stored verbatim from git (only created workspaces pass
`toBranch`), so an option-shaped branch from an untrusted repo (`--repo=x` is creatable via
`git update-ref`) must be rejected before it reaches any git/gh argv, **then rejects when the branch
IS its base** (`ws.branch === baseRef(ws.baseBranch)`, before the origin check or any push): the
Default workspace's cwd is the project's own checkout, so `branch`/`baseBranch` commonly coincide
whenever the user is on the repository's default branch (`workspaces`' `folderTruth` tracks both off
the live `git symbolic-ref`), and an external (adopted) workspace can equally sit on its base — without
this guard, Open PR would `git push origin <default-branch>` straight to the shared branch on an
unprotected remote, publishing the commits before any PR could offer its review boundary. The client
disables the Open PR affordances (header button, draft-PR menu item, the "ready to ship" banner) the
same way for the same reason. **`refreshUserOwnedWorkspace(workspaceId)` resolves the LIVE branch for
Default/external workspaces** (`workspaces`' same sync used by the fs-watcher tee) and persists it — a
no-op for created workspaces, whose branch only ThinkRail ever moves. Open PR validates once before its
async dirty-file read (preserving the safe base-branch fast failure), then refreshes, reloads, and
revalidates immediately after that await. Without both, a branch switched in a terminal while the Git
read is in flight or moments before pressing Open PR would push/open/compare against the STALE persisted
branch until the async watcher next catches up: the branch-sensitive `ws` is fresh, so the
base guard, the push, the `gh` lookup/create, and the compare URL all derive from the one refreshed
value. Then:
1. No `origin` remote → throws (the client toasts it). Push failure → throws with git's stderr;
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
3. Non-GitHub origin (incl. local/bare test remotes) → `action: "pushed"` — the honest floor.
4. GitHub origin: an existing open PR (`gh pr list --head <branch> --base <input.base>`, parsed by
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
   won't be in the PR. Dirty state never blocks.

The open-PR *read* side stays `workspace.openReview` (`branch-review`) — this module persists
nothing; the client re-derives button/chip state from that lookup plus this call's result. That
lookup is cached, so every successful push drops the worktree's prior answer: pushing may change the
branch's remote configuration even when the remote is not GitHub or the action falls back to compare.
A GitHub mutation attempt drops it again after settlement, so a concurrent "no PR" read cannot survive
an update, a create, or an ambiguous create result.

## Boundary

- **Owns:** the push + PR action, PR-body rendering from the wire plan, GitHub slug/compare-URL
  derivation.
- **Public surface (barrel):** `openPr`, `previewPr`.
- **Allowed deps:** `workspaces` (workspace record, `refreshUserOwnedWorkspace`), `git` (exec + status), `todos` (`listTodos` for
  the body), `branch-review` (provider detection, existing-PR lookup, the shared command runner,
  `forgetOpenBranchReview`),
  `github` (`ghSetupProblem` — the named compare-fallback reason); `contracts` types;
  `shared/codedError` (`PUSH_AUTH_FAILED`).
- **Forbidden:** `host`; provider HTTP APIs or stored tokens (auth stays external — the user's `gh`
  only); persisting PR state (that would duplicate `workspace.openReview`'s derivation).
- All `gh` traffic flows through one injected `PrCommandRunner` so unit tests never spawn a real CLI.
