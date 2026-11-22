# intake.md — the PR, its code, its groups

Entry: a PR reference in the request (a link or a number), or none. Saves `pr.md`, `pr-body.md`,
`groups.md` and `repo.md` under `.thinkrail/context/review-<n>/`. Control goes next to
`measuring.md` and `mapping.md`, run together.

## 1. Resolve the PR

- Take the link or number from the request. With none, list open PRs (`gh pr list --repo
  <owner>/<repo>`, the repository chosen as for a bare number below) and ask which one with
  `ask_user_question`; this is the only question before the brief.
- Pin the PR to its repository. From a link, `<owner>/<repo>` is in the URL. From a bare number,
  take the first GitHub remote in the order `upstream`, `github`, `origin`, then the rest (the New
  Workspace picker's order), and confirm it with the user when the checkout has several. Every later
  `gh` call names `<url>` or `--repo <owner>/<repo>`, never a bare number: `gh` prefers its own
  configured default repository, which may be another one.
- No `gh`, not signed in, or a remote that is not GitHub: say so in one line and stop. That is a
  terminal state of the workflow.

## 2. Read the facts

```
gh pr view <url> --json number,title,author,state,isDraft,baseRefName,headRefName,headRefOid,additions,deletions,changedFiles,mergeable,reviewDecision,mergedAt,mergeCommit,url,body
gh pr checks <url>
gh api --paginate repos/<owner>/<repo>/pulls/<n>/reviews
gh api --paginate repos/<owner>/<repo>/pulls/<n>/comments
```

- Save the description to `pr-body.md`: later stages check its claims.
- Earlier reviews, a bot's included, are input. Their findings go on the "already filed" list; an
  approval is not evidence.

## 3. Put the PR's code in the workspace

Only a fresh workspace is moved: a clean tree and no commits of its own, on a branch of its own.

`<remote>` is the remote whose URL names `<owner>/<repo>` (`git remote -v`) and `<name>` is that
remote's name; when no remote does, `<remote>` is `https://github.com/<owner>/<repo>.git` and
`<name>` is `review`.

**Any other checkout is never touched.** Fetch the base first (the second command below; it leaves
the checkout alone). A fresh review workspace passes every check: `git status --porcelain` prints
nothing, the branch has no commits `<name>/<base>` lacks, it is not `<base>` itself, it has no
upstream (`git rev-parse @{u}` fails), its reflog holds only its creation and renames (every line of
`git reflog show --format=%gs <branch>` starts `branch: Created from` or `Branch: renamed`; naming the
workspace renames it), and this is not the repository's main checkout (`git rev-parse --git-dir`
differs from `--git-common-dir`). When any check fails, start the review elsewhere: call
`start_workspace` in this project with `base_branch` set to `<name>/<base>` and, as its prompt, the
same request plus a last line `Handed off from <this workspace>; do not hand off again.` Tell the user,
in one line, where the review now runs. That ends this workflow here: **Handed off**, a terminal
state. Without that tool, offer the separate workspace and stop.

A request that carries that hand-off line never hands off again: if a check fails there, report which
one and stop. That, too, is a terminal state.

```
git status --porcelain                                   # must print nothing
git fetch <remote> +refs/heads/<base>:refs/remotes/<name>/<base>
git rev-list --count <name>/<base>..HEAD                 # must be 0
git fetch <remote> +pull/<n>/head:refs/remotes/<name>/pr-<n>
git reset --hard <name>/pr-<n>                           # the branch now is the PR head
git merge-base <name>/<base> HEAD                        # the base for every later diff
```

- **A PR merged with a merge commit** is already inside `<base>`, so that merge base is the head
  itself and every diff is empty. Take the base from before the merge instead:
  `git merge-base <mergeCommit>^1 HEAD`. Say in the first message that the Changes tab, which
  measures against today's base, shows nothing for this workspace; the stages use the recorded base.
- Record the PR's URL, the head SHA and the merge base in `pr.md`. Every later stage uses these.
- Name the chat and workspace now, by the naming tool's own rule for a linked PR.
- When the repository needs an install before tests run, start it as a background command now.

## 4. State, and the merge race

Tell the user, in the first message they get:

- open, draft, merged or closed; checks; who approved;
- **whether the PR can merge while the review runs** (approved and mergeable). A review that
  takes hours loses to an approval that takes minutes; say so plainly.
- A merged or closed PR is still reviewed. Posting then means comments or an issue
  (`posting.md`).

## 5. The complete file list

```
git diff --numstat -M <merge-base> HEAD
git diff --name-status -M <merge-base> HEAD
git log --reverse --format='%h %s' <merge-base>..HEAD
```

Never take the file list from `gh pr view --json files`: it stops at 100 files without saying so.

## 6. Change groups

Split the PR into 3 to 9 groups **by intent**, using the commits and the paths:

- A group is one capability, one module, or one family of similar rewrites; about 3,000 changed
  lines at most.
- Tests travel with the code they test. When many end-to-end tests changed, they form one extra
  group of their own.
- Specs, docs and translations go to the nearest code group.
- Mark what makes a group risky: a wire or schema change, persistence, files written on disk,
  authentication, concurrency, a shared building block many callers use.

Write `groups.md`: for each group its name, a one-line guess at its purpose, its files, its size
and its risk marks. Independent work bundled into one PR (a server change inside a UI rewrite) is
noted here; it becomes a line in the brief.

## 7. How this repository runs

Read the repository's own instructions (`AGENTS.md`, contributing notes, the README) and write
`repo.md`:

- the commands for unit tests, type checks, lint and check scripts, and how to run one test file;
- whether a browser or end-to-end harness exists, how a focused run is started, and how long it
  takes;
- rules a reviewer must hold the PR to (module boundaries, suppressions, comments, specs);
- what cannot be run here, with the reason.

## 8. Plan and first message

Publish the eight stages as the plan. Then one short message: the PR's state and merge-race line,
its size, the groups, and that the brief comes at the end.

## Next

Read and follow `measuring.md` and `mapping.md`; their agents start together.
