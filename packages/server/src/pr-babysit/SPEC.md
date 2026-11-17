---
id: submodule-server-pr-babysit
type: submodule-design
status: draft
title: pr-babysit — PR Babysit & Independent Review for a workspace's open GitHub PR
parent: module-server
depends-on: [module-contracts, submodule-server-subprocess, submodule-server-git, submodule-server-persistence]
tags: [github, pull-request]
---

## Responsibility

Two agent roles watch one workspace's open GitHub pull request:

- **Independent PR Reviewer** (read-only): when babysitting starts, and whenever the PR head moves past
  `lastReviewedOid`, reviews the PR diff (`origin/<base>...<head>`) plus every `SPEC.md` from each
  changed path up to the root, and files JSON findings (`blocker` / `warning` / `suggestion`).
- **PR Babysitter** (worktree fixer): polls unresolved review threads, failing check runs, and
  queued findings; runs one fix at a time in the PR's worktree; commits `fix(pr-review): <summary>`;
  pushes (or stages for approval); replies `[helios-babysit] Fixed in <sha>: <explanation>`; optionally
  resolves the thread.

## Boundary

- **Owns:** `github.ts` (the `gh api graphql` PR-state query + pure `parsePrSnapshot`, reply / resolve
  thread / post review / failed-run log tail, the self-loop guard `isIgnoredComment`); `store.ts` (the
  `pr-babysit.json` session table, the item status transition table, pure snapshot→item and
  finding→item folds, derived session status, the push-cycle cap); `reviewer.ts` (reviewer prompt and
  output contract, tolerant findings / patch-verdict parsers, SPEC discovery, GitHub review rendering);
  `watcher.ts` (`createBabysitEngine` — the per-session adaptive poll loop and fix dispatch).
- **Public surface (barrel):** `createBabysitEngine`, `createPrBabysitStore`, `runGh`, and their types.
- **Allowed deps:** `contracts`, `shared/codedError`, `subprocess` (`runBounded` for `gh`), `git`
  (`nonInteractiveGitEnv` only — the engine's git runner is injected). Persistence is injected as a
  `StoreBackend`.
- **Forbidden:** importing `agent`, `host`, `workspaces`, or `settings`. Every agent operation (start or
  reuse the fixing chat, prompt it and await `agent_settled`, run the hidden reviewer child) arrives
  through the `BabysitAgent` seam that `host/prBabysit.ts` composes from `agent`, the same way
  `review.send*` is composed.

## Behavior

- **Start** (`prBabysit.start`) resolves owner/repo from the `origin` remote and the PR from the
  workspace branch on the host; the client never names a repository, PR number, or path. The session
  snapshots `AppConfig.prBabysit` (merged with the request's patch) and the `gh api user` login.
  Restarting babysitting on the same PR keeps its items; a capped session's cycle count resets.
- **Poll:** 30 s while checks are pending, a fix or review runs, or items are queued; 2 min when idle.
  `MERGED` / `CLOSED` stops the session. A failed fetch records `error` and retries next tick.
- **Items** are keyed stably (`thread:<id>`, `check:<hash(name, head)>`, `finding:<hash(path, line,
  summary)>`) so neither a restart nor a re-review duplicates one. A thread queues when its newest
  comment is someone else's; a newer human comment requeues a pushed/resolved thread (`lastCommentId`
  remembers the last one handled). A failing check queues once per head; queued checks of an older head
  are superseded. A finding queues (`review_and_auto_queue`, blocker/warning) or waits for approval.
- **Self-loop guard:** comments by the authenticated login, or containing `[helios-babysit]` /
  `[helios-review]`, are never acted on. Everything either agent posts carries its marker.
- **Fix:** refuses (→ `needs_human`) when the worktree is dirty, not on the PR head branch, or cannot
  fast-forward to `origin/<head>`. The fixer prompt carries the item, thread history, failing-log tail,
  and diff hunk; the agent is told not to commit, push, or reply. The host commits whatever changed (its
  final text becomes the commit body and the reply). No change → `needs_human`.
- **Patch sanity check:** unless review is `off`, the reviewer checks the fix commit before any push;
  an explicit `reject` stages it as `needs_human` with the reason. An unparseable verdict approves —
  the check is a net, never a wedge.
- **Push:** `auto_push` pushes `HEAD:refs/heads/<head>` and counts one cycle; at
  `config.maxPushCycles` the session stops pushing and reports `needs_human`. `stage_for_approval`
  leaves the commit local until **Approve & Push**, which pushes and finalizes every staged item whose
  commit `HEAD` now contains (human pushes do not count as cycles).
- **Reviewer isolation:** a hidden, ephemeral delegation child of the babysit chat with tools
  `read grep find ls spec_*` only — no edit, write, or shell — on `config.reviewerModel`, else the plan
  reviewer's model, else the new-chat default.
- **Posting:** `post_to_github` (and the drawer's **Post to GitHub**) submits a `[helios-review]`
  review: anchored findings inline, `REQUEST_CHANGES` on a blocker; it falls back to `COMMENT`
  (GitHub refuses requesting changes on your own PR) and then to a body-only review (an inline anchor
  outside the diff is refused).
- **Restart:** every write is saved at once; a `working` item loads back as `queued`, and
  `resume()` restarts active sessions at boot.
- **Events:** each change publishes `prBabysit.changed` `{ kind, itemId?, state }` with the whole state.

## Decisions

- The engine lives in the TypeScript host, not the Tauri shell: agent turns run in-process (`pi` is
  never a subprocess or a second runtime), the web client speaks only the WS protocol, and the
  browser/CLI/Electrobun launchers must get the feature too. "Harness" is therefore always `pi`; the
  user picks the babysit and reviewer **models**.
- State is a JSON file under the data dir like every other host store, not SQLite: one writer, small
  tables, atomic replace.
- Dismissing a staged fix leaves its local commit in place (never a destructive reset); the next push
  carries it.
