---
id: ext-git-pulse
type: submodule-design
status: active
title: git-pulse — git dashboard extension for the active workspace
parent: module-ext-sdk
depends-on: [module-ext-sdk]
references: [submodule-server-ext, submodule-web-ext, submodule-server-git, ext-timeline, ext-railmap]
tags: [extensions, example]
---

## Responsibility

Answers "what branch am I on, what is not pushed or pulled yet, and what did I change?" for the active
workspace checkout, without leaving ThinkRail. A ThinkRail UI extension written only against
`@thinkrail/ext` and `@thinkrail/ext/view`; the SDK README's fourth example and the reference for
`tr.onWatch`.

## Model (`model.ts`, shared)

`Pulse` is one of `loading`, `not-git { path }`, `error { path?, message }`, or `ready { path, head,
upstream?, counts, files, filesTotal, stash, commits }`.

- `head`: `branch { name, oid }`, `unborn { name }` (no commits yet), or `detached { oid }`.
- `upstream`: `{ name, ahead, behind, gone }`; `gone` when the upstream ref no longer exists.
- `counts`: `staged` (index column set), `unstaged` (worktree column set), `untracked`, `conflicted`.
- `files`: at most 200 entries `{ path, from?, kind: tracked | untracked | conflicted, index, worktree }`
  (`from` for a rename or copy); `filesTotal` counts all of them.
- `commits`: the last 20 from `HEAD`, `{ hash, short, subject, author, time }` (`time` = author time, ms).
  Relative time is computed in the view.

## Host half

- Git runs with `execFile` (no shell) in the workspace `path` from `tr.workspaces`, with
  `--no-optional-locks`, `GIT_TERMINAL_PROMPT=0`, and `LC_ALL=C`, so it never writes the index, never
  waits for an https password, and parses stable English output. The user's ssh client is left alone
  (same rule as `submodule-server-git`): forcing `BatchMode` would override their `core.sshCommand` and
  kill `SSH_ASKPASS` dialogs; the 60 s fetch timeout bounds a prompt instead. Reads: one `git status
  --porcelain=v2 --branch --show-stash -z` (default untracked mode: an untracked directory is one entry;
  parsed by pure `parse.ts`) and one `git log -n20` (skipped for an unborn branch). `rev-parse --absolute-git-dir` finds the git dir for the
  watcher (a linked worktree gets its own).
- **Demand.** A workspace is tracked only while a view reads `pulse:<workspaceId>`: `tr.onWatch` starts
  tracking on the first view and stops it on the last one (watcher closed, key unpublished). Tracked
  workspaces refresh every 4 s (`tr.every`) and 250 ms after any change in the git dir (one
  non-recursive `fs.watch`, closed by the returned disposer). Each tracked workspace owns an
  `AbortController`; stopping it or disposing the extension kills its running git reads and fetch. Refreshes of one workspace never overlap;
  a request during a run queues one more. A value equal to the last published one is not republished.
- Not a repository → `not-git`; a missing directory, closed workspace, or failing git → `error`.
- **Mutations.** The only command that changes the repository is `git fetch --all
  --no-auto-maintenance` (60 s timeout), from the `fetch` action. It updates remote-tracking refs and
  `FETCH_HEAD` only. Nothing else writes.
- Actions: `fetch` (`ctx.workspaceId`; → `{ ok, output, at }`, then a refresh; a second call while one
  runs joins it), `refresh`.

## Views

- `badge` (status): `⎇ feat/x ↑2 ↓0 · 5 changed` for the active workspace (`clean` when nothing
  changed; no arrows without an upstream); hidden for a non-git workspace; a red icon with the message
  as its title on `error`. Click opens the tab.
- `dashboard` (tab): head, ahead/behind, upstream and path, count chips, **Refresh** and **Fetch** (the
  fetch output shows under the header, green or red), then the commit list and the changed-file list
  side by side (stacked when narrow). Each file row shows git's two status letters: index in green,
  worktree in amber; `??` untracked, `!!` conflicted.

## Boundary

- Public surface: the `dashboard` and `badge` surfaces, actions `fetch`/`refresh`, and the
  `pulse:<workspaceId>` channel.
- Host half: `index.ts`, `git.ts`, `parse.ts`. Views: the `.tsx` files plus `hooks.ts`. `model.ts` is
  shared (types and pure helpers, no Node imports).
- Allowed dependencies: `@thinkrail/ext`, `@thinkrail/ext/view`, `react`, and Node built-ins
  (`child_process`, `fs`) in the host half.
- Forbidden: any ThinkRail package internals (`packages/*/src`, `apps/*`), views importing host-half
  files, the host half importing views, and any git command that changes the repository other than
  `fetch`.

## Known limitations

- The watcher is not recursive. Commits, checkouts, staging, and fetches write files at the top of the
  git dir (`COMMIT_EDITMSG`, `HEAD`, `index`, `FETCH_HEAD`) and refresh at once; a change only under
  `refs/` (a `git push` moving a remote-tracking ref) waits for the next 4 s poll.
- `--show-stash` needs git 2.35 or newer; an older git reports 0 stashes.
- Submodules show as changed files; their own state is not read.
- An untracked directory shows as one `dir/` entry, not its files. `git status` output past 8 MB (tens of
  thousands of changed tracked files) turns the pulse into `error`.
- An ssh passphrase prompt on a controlling terminal holds `fetch` until the 60 s timeout.
