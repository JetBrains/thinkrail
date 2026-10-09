---
id: submodule-server-turns
type: submodule-design
status: active
title: turns — the change set each agent run produced
parent: module-server
depends-on: [module-contracts, submodule-server-git, submodule-server-persistence]
references: [submodule-web-panels, submodule-web-chat]
tags: [git, review]
---

## Responsibility

Answer "what did this agent run change?" without trusting tool arguments. At `agent_start` the tracker
snapshots the worktree into a git **tree object** (`snapshotWorktree`: the real index is copied to a
scratch `GIT_INDEX_FILE`, `add -A` runs against the copy, `write-tree` returns the oid — tracked edits
and untracked files included, ignored files and the user's real index untouched); at `agent_settled` it
snapshots again and, when the trees differ, records a `TurnChangeSet` — both tree oids, the run's wall
clock, and `gitStatus` over the `turn` scope between them — persists it, and pushes `turn.changed`.
The run boundary is `agent_start`→`agent_settled`, pi's round (a prompt and everything it caused), not
pi's `turn_*` (one assistant message): a receipt per message would fragment one answer into many cards.

## Boundary

- **Owns:** `TurnTracker` (per-session pending run → settle, plus `drain()` for in-flight recording), `turns.json` under the data dir
  (`persistence.loadTurns` / `saveTurns`, versioned, atomic, capped at 30 runs per workspace, dropped
  with the workspace), `listTurns(workspaceId)`, `turnScope(turn)`, the `turn.changed` publisher seam.
- **Public surface (barrel):** `TurnTracker`, `listTurns`, `forgetWorkspaceTurns`, `setTurnPublisher`,
  `turnScope`.
- **Consumers:** `host` wires the tracker into the session publisher beside run analytics and serves
  `workspace.turns`; `git` resolves a `turn` scope as `diff <baseTree> <headTree>` with both sides
  immutable (no untracked pass, `modifiedRef` set — so `changes` refuses to mutate it, exactly like a
  commit scope).

## Decisions

- **Snapshots, not tool arguments.** The chat's turn divider already lists paths from `write`/`edit`
  arguments; that misses shell writes, formatters, and generators, and knows nothing about renames or
  line counts. A tree snapshot is what the agent actually left behind.
- **Trees, not commits.** A snapshot must not touch HEAD, the index, or the reflog; dangling trees cost
  only object storage and `git gc` prunes them after its grace period. The price is that a very old
  turn may stop resolving — the scope then fails with `UNKNOWN_COMMIT` and the client resets to *All
  changes* exactly as for a rewritten commit.
- **A receipt is the workspace's interval, not the run's authorship.** Both snapshots cover the whole
  worktree, so a second chat, a user edit, or a revert landing while this run is pending appears in its
  receipt too. Exclusive attribution would need per-write provenance the host does not have; tool
  arguments were exactly the unreliable source this module replaces.
- **Zero-change runs record nothing.** A receipt that says "0 files" is noise, and *Last turn* means
  the last run that changed something.
- **The first `agent_start` of a run wins.** pi re-emits `agent_start` on retries; a pending run is kept
  until its settle, so the base snapshot is the state before the agent's first write.
- **Both snapshots start at their boundary.** The base snapshot starts at `agent_start` and the head
  snapshot at `agent_settled`, each synchronously inside the event handler; the settle then awaits both.
  Waiting for a slow base before starting the head would let the next run's first writes leak into this
  run's receipt. What remains is the accepted race: a snapshot is asynchronous git work, and an agent
  write that lands while it runs may fall on either side. Model latency makes this practically
  impossible for the first tool call; a blocking snapshot would delay every run start on large repos.
- **Receipts belong to the captured workspace, not a live session.** Capture the workspace id and
  worktree path at `agent_start`; a session detached during settlement must not lose its receipt.
  Independently check the workspace registry immediately before record/publish, so workspace removal
  still cannot recreate its entry in `turns.json` (`forgetWorkspaceTurns` only deletes existing records).
  `workspace.turns` likewise rejects an unknown workspace.
- **Graceful shutdown drains recording after settling sessions, before disposal.** `drain()` awaits
  the jobs begun at `agent_settled`; it never invents a settle for a pending start. It is bounded
  (5 s) like the session settle before it: a git stalled on a slow filesystem costs that run's receipt,
  never a quit that hangs for minutes. Synchronous `stop()` remains the emergency path, not a recording
  barrier.
- **Start order is the order.** Turns are stored and capped by `startedAt`, not by settle time, so a
  later-started run that settles first does not become "Last turn" — the client applies the same rule
  to a live `turn.changed`, so a reload never disagrees with the push.
- The host subscribes every socket to `turn.changed` at open, like the other workspace channels; a
  receipt that only ever reached the client through `workspace.turns` on reload is the bug this line
  guards against.
