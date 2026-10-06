---
id: submodule-server-branch-review
type: submodule-design
status: active
title: branch-review — open PR/MR metadata
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
(merge or close time) on the `OpenBranchReview`: one lookup serves the topbar chip (open = success,
merged = info, closed = neutral) and the Settled shelf's "PR merged/closed" rule, instead of two polls
disagreeing. A pre-v78
consumer that only understood open reviews reads a merged/closed row as a live PR, which is why the
contracts spec pins `state` to `WORKSPACE_SETTLE_PROTOCOL_VERSION`.

## Boundary

- **Owns:** remote-host detection and bounded, asynchronous CLI lookup returning an `OpenBranchReview` or `null`, plus the short-lived memory of successful lookup answers.
- **The lookup asks the provider for the review's `url` alongside its number** (`gh … --json number,url`;
  GitLab's row carries `web_url`) and puts it on the `OpenBranchReview`. It is not decoration: the client's
  `PR #N` chip is a link only when a url is known, and before this the url existed ONLY in the session that
  had just run `pr.open` — every reload, second window, and reconnect rendered the number as dead text. A
  row whose url is absent or not `https:` yields a review with no url rather than a bad link.
- **Public surface:** `findBranchReviewOutcome(cwd, branch, { fresh? })` → `{ value, reliable }` — `reliable`
  is the cacheable bit surfaced, so a host that *persists* the answer can tell "the provider says there is
  no review" from "the provider did not answer" and keep its last-known snapshot through a `gh` outage;
  `forgetOpenBranchReview(cwd)`; plus the read primitives the `pr` action module reuses —
  `providerFromRemoteUrl`, `reviewNumber`, and `runProviderCommand` (the bounded prompt-disabled CLI runner).
- **Successful answers are cached per `(worktree, branch)` for 60 seconds from settlement and lookups are
  single-flighted.** A syntactically valid empty provider response is a successful `null` and is cached —
  "no PR" is the common case and the expensive one to re-derive. A provider-CLI failure, failed mandatory
  local-remote inspection, thrown runner, or malformed response still degrades to `null` for the caller
  but is not retained, so fixing CLI auth or a
  transient outage can recover on the next read. Expired entries are pruned lazily on cache activity.
- Ordinary workspace activation may reuse a settled answer; `{ fresh: true }` bypasses one while still
  joining an already-running lookup. The web uses the fresh path on window focus, preserving focus as the
  explicit revalidation point for reviews opened, closed, or merged outside ThinkRail.
- `forgetOpenBranchReview(cwd)` invalidates every branch generation for that worktree. A lookup superseded
  while in flight must resolve through the current generation rather than return or re-cache its stale
  answer; this is what makes invalidation safe against a concurrent read.
- **Allowed deps:** `contracts` for the result type; the server `git` barrel for local remote inspection and for `nonInteractiveGitEnv()`, the one definition of the environment a subprocess runs under — `process.env` plus `GIT_TERMINAL_PROMPT=0` (this module layers its own `GH_PROMPT_DISABLED`/`GLAB_PROMPT_DISABLED` on top); the `subprocess` barrel, which runs the lookup under this module's `LOOKUP_TIMEOUT_MS`.
- **Forbidden:** `host`, `workspaces`, browser code, persistence, or any PR/review action beyond this read (actions live in `pr`).
- Missing CLI/authentication, unsupported remotes, timeouts, malformed output, and no open review all degrade to `null`.
- **The bound has to be the *call's*, not the child's.** Killing `gh`/`glab` and then awaiting its stdout to
  EOF never returns when a grandchild inherited that pipe, and `review.get` awaits this lookup — so the
  degrade-to-`null` promised above was reachable only through the client's own causeless request timeout.
  `subprocess`' `runBounded` is what makes `LOOKUP_TIMEOUT_MS` real; this module must never grow a second
  spawn of its own.
