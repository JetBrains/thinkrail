---
id: submodule-server-branch-review
type: submodule-design
status: active
title: branch-review — open PR/MR metadata and the project's pull requests
parent: module-server
depends-on: [module-contracts]
implements: [task-branch-pr-awareness]
tags: [github, gitlab, pull-request]
---

## Responsibility

Best-effort lookup of the code review associated with a workspace branch — open, merged, or closed —
GitHub.com PR via the local `gh` CLI or GitLab.com MR via `glab`. The lookup asks for **an open review
first** (`gh pr list --state open --limit 1`, `glab mr list --per-page 1`; one call, the same as before
settled states existed) and **only when there is none pages the newest merged/closed rows** (`--state
all` / `--all`, five rows, the most recently merged or closed one wins). Two bounded calls rather than
one combined page because a combined page is ordered by creation: a branch with an older still-open
review and several newer settled ones would present only the settled ones, and a host trusting that
answer would shelve a workspace whose PR is still open. The answer carries `state` and `changedAt`
(merge or close time) on the `OpenBranchReview`: one lookup serves `workspace.branchStatus` / `openReview`, the topbar chip (open = success,
merged = info, closed = neutral) and the Settled shelf's "PR merged/closed" rule, instead of two polls
disagreeing. A merged/closed row is reliable only with its matching merge/close timestamp; without that
ordering fact the host cannot prove whether later work should stay live, so it rejects the answer rather
than persisting incomplete shelf authority. A pre-v78
consumer that only understood open reviews reads a merged/closed row as a live PR, which is why the
contracts spec pins `state` to `WORKSPACE_SETTLE_PROTOCOL_VERSION` and the host answers such a client's
`workspace.openReview` with `null` for a merged or closed review.

It also answers the prompts' pull-request completion (`pr.list` / `pr.sizes` / `pr.authors` / `pr.get`, v133,
`pullRequests.ts`): pages of a project's open GitHub pull requests for a filter, their diff stats, and
one pull request by number in any state, as `PullRequestSummary` rows. Not keyed by a branch.

- **The repository is the first GitHub remote in `gh`'s own order** (`upstream`, `github`, `origin`,
  then the rest) and every call names it (`repo:<slug>`, `--repo <slug>`, `owner`/`name` variables) so
  `gh` never falls back to its own default repository. `baseRef` is `<that remote>/<baseRefName>`: a fork
  checkout reviews the PRs of the repository it forked, and the workspace is cut from that
  repository's base. No GitHub remote → `not-github` without running `gh`.
- **A page is one GitHub search** (`gh api graphql`, `search(type: ISSUE, first: 20, after)`):
  `repo:<slug> is:pr is:open sort:updated-desc` plus the filter's qualifiers — `review-requested:@me` or
  `author:@me` for the scope, `draft:false` without drafts, `author:<login>` (a login-shaped value only, and never with `author:@me`, which GitHub would OR with it),
  and the typed words with `in:title`. Typed words are words only: any token with a `:`, the `AND` /
  `OR` / `NOT` operators, quotes and leading `-`/`+` are dropped, because GitHub ORs `repo:` qualifiers
  and a typed one would widen the search to another repository; a row whose URL is not under
  `https://github.com/<slug>/pull/` is dropped as well. GitHub filters and pages, so a filter or a search reaches every
  open PR, not just the newest. A row is marked `reviewRequested` in the waiting scope, or when a user
  review request names the signed-in `viewer` (a team request is visible only in the waiting scope).
- **Rows come without sizes; `pr.sizes` adds them.** Diff stats are most of GitHub's answer time
  (measured on 46 PRs: ~0.7 s without, 1–3 s with), so the page returns first and one aliased query
  (`p<N>: pullRequest(number: N)`, 50 numbers at most) fills in the shown rows. `pr.get` reads one PR
  with its size through `gh pr view`. `pr.authors` pages the same open-PR search 100 at a time
  asking only for `author { login }`, so the Author filter lists everyone with an open PR — not only the
  authors of the rows already loaded — and is cached like a page.
- **Successful answers are kept 60 s** — pages per (worktree, search, cursor), sizes per (repository,
  number) — so reopening the completion or paging back is instant. Failures are never kept, and
  expired entries are pruned whenever a new one is stored, so per-keystroke queries never accumulate.
- **One budget per call.** Remote inspection, the query and the diagnosis share `LOOKUP_TIMEOUT_MS`
  from the first call.
- **Failures are named, never thrown.** A failed search asks `github`'s `ghSetupProblem()` — only
  then, as `pr.open` does — for `missing` / `unauthenticated`; anything else (a usable `gh` that
  failed, a malformed answer, a probe that did not answer in time, or the `THINKRAIL_GH_OFFLINE` seam,
  where the probe reports `null` by design) is `failed`, which the completion offers to retry.
  `pr.sizes` leaves out what it could not read, and `pr.authors` answers an empty page; `pr.get` degrades every failure to `null`.

## Boundary

- **Owns:** remote-host detection and the bounded, asynchronous CLI lookup of a branch's review, returning an `OpenBranchReview` or `null`, plus the short-lived memory of successful lookup answers; and the uncached listing and lookup of a project's GitHub pull requests (`PullRequestList` / `PullRequestSummary`).
- **Remote-host detection is asynchronous too.** Its `git config` / `git remote` reads run through
  `gitAsync` under `LOOKUP_TIMEOUT_MS`, never a synchronous spawn: the host's settled-lifecycle pass runs
  this lookup for every candidate row every five minutes, and the synchronous reads blocked the whole host
  (every chat, agent, and terminal) for ~45 ms per row.
- **The lookup asks the provider for the review's `url` alongside its number** (`gh … --json number,url`;
  GitLab's row carries `web_url`) and puts it on the `OpenBranchReview`. It is not decoration: the client's
  `PR #N` chip is a link only when a url is known, and before this the url existed ONLY in the session that
  had just run `pr.open` — every reload, second window, and reconnect rendered the number as dead text. A
  row whose url is absent or not `https:` yields a review with no url rather than a bad link.
- **An open GitHub PR's review facts ride the same open-row call** (`isDraft, reviewDecision,
  mergeStateStatus, statusCheckRollup, latestReviews` join the `--json` list — no second call per read) and
  become `OpenBranchReview.details` — only when the PR's head repository (`headRepositoryOwner` /
  `headRepository`, also requested) is origin's own: `--head` matches by branch name alone, so a fork's PR
  from a same-named branch is found too, and it must never look like something this workspace can act on.
  The settled page asks for the head repository too and drops a known foreign row before picking, so a
  fork's merged or closed same-named PR never shelves this workspace or offers Reopen.
  Checks count each check once by its newest attempt (a re-run appears
  per attempt in the rollup): SUCCESS / NEUTRAL / SKIPPED pass; FAILURE / TIMED_OUT / CANCELLED /
  ACTION_REQUIRED / STARTUP_FAILURE fail; anything not completed (and PENDING / EXPECTED status contexts)
  is pending; STALE counts as nothing, since a never-finishing check would keep the client's CI poll alive
  forever. Only a row that carries the detail fields gets details, so GitLab and settled rows keep their
  shape. The repository's merge methods and `deleteBranchOnMerge` come from `gh repo view`, asked only
  when such a PR exists and cached per origin URL for 10 minutes (successes only); a failed read leaves
  them out without failing the lookup.
- **Public surface:** `listPullRequests(cwd, { filter, query?, cursor? })` / `pullRequestSizes(cwd, numbers)` /
  `listPullRequestAuthors(cwd, cursor?)` /
  `getPullRequest(cwd, number)` (above);
  `findBranchReviewOutcome(cwd, branch, { fresh? })` → `{ value, reliable }` — `reliable`
  is the cacheable bit surfaced, so a host that *persists* the answer can tell "the provider says there is
  no review" from "the provider did not answer" and keep its last-known snapshot through a `gh` outage;
  `forgetOpenBranchReview(cwd)`; plus the read primitives the `pr` action module reuses —
  `providerFromRemoteUrl`, `githubSlug` (owner/repo of a GitHub remote URL, shared with `pr`), `reviewNumber`, and `runProviderCommand` (the bounded prompt-disabled CLI runner;
  it returns stderr as `err` so a refused mutation can say why).
- **Successful answers are cached per `(worktree, branch)` for 60 seconds from settlement and lookups are
  single-flighted.** A syntactically valid empty provider response is a successful `null` and is cached —
  "no PR" is the common case and the expensive one to re-derive. A provider-CLI failure, failed mandatory
  local-remote inspection, thrown runner, or malformed response still degrades to `null` for the caller
  but is not retained, so fixing CLI auth or a
  transient outage can recover on the next read. Expired entries are pruned lazily on cache activity.
- Ordinary workspace activation may reuse a settled answer. `{ fresh: true }` bypasses the settled cache and starts a new lookup generation even when an older lookup is in flight. Ordinary concurrent lookups share the current generation; callers of a superseded generation resolve through the current generation, and only the current generation may update the cache. The web uses the fresh path on window focus, and the host uses it when an agent settles and during periodic review refresh, so reviews opened, closed, or merged outside the app's own actions can surface without another local file change.
- `forgetOpenBranchReview(cwd)` invalidates every branch generation for that worktree. A lookup superseded
  while in flight must resolve through the current generation rather than return or re-cache its stale
  answer; this is what makes invalidation safe against a concurrent read.
- **Allowed deps:** `contracts` for the result type; `github` (`ghSetupProblem`, the named reason a
  pull-request listing failed); the server `git` barrel for local remote inspection and for `nonInteractiveGitEnv()`, the one definition of the environment a subprocess runs under — `process.env` plus `GIT_TERMINAL_PROMPT=0` (this module layers its own `GH_PROMPT_DISABLED`/`GLAB_PROMPT_DISABLED` on top); the `subprocess` barrel, which runs the lookup under this module's `LOOKUP_TIMEOUT_MS`.
- **Forbidden:** `host`, `workspaces`, browser code, persistence, or any PR/review action beyond this read (actions live in `pr`).
- For the branch lookup, missing CLI/authentication, unsupported remotes, timeouts, malformed output, and no open review all degrade to `null` (the pull-request listing names its reasons instead, above).
- **The bound has to be the *call's*, not the child's.** Killing `gh`/`glab` and then awaiting its stdout to
  EOF never returns when a grandchild inherited that pipe, and `review.get` awaits this lookup — so the
  degrade-to-`null` promised above was reachable only through the client's own causeless request timeout.
  `subprocess`' `runBounded` is what makes `LOOKUP_TIMEOUT_MS` real; this module must never grow a second
  spawn of its own.
