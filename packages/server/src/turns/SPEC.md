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

- **Owns:** `TurnTracker` (per-session pending run → settle), `turns.json` under the data dir
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
- **Zero-change runs record nothing.** A receipt that says "0 files" is noise, and *Last turn* means
  the last run that changed something.
- **The first `agent_start` of a run wins.** pi re-emits `agent_start` on retries; a pending run is kept
  until its settle, so the base snapshot is the state before the agent's first write.
- **Accepted race:** the base snapshot is asynchronous and an agent write that lands before it finishes
  would be missed. Model latency makes this practically impossible for the first tool call; a
  blocking snapshot would delay every run start on large repos.
