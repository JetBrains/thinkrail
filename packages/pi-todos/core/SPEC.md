---
id: submodule-pi-todos-core
type: submodule-design
status: draft
title: pi-todos core (pi-free model)
parent: module-pi-todos
tags: [pi-extension, todos, v2]
---

## Responsibility

The pi-free TODO model: the `Todo` types (the status vocabulary) and `TodoStore` — a **per-session**
list stored as one file, `.thinkrail/context/todos/<sessionId>.json` (under the ephemeral context scratch
dir), read and written by read-modify-write. The
file is the source of truth; the store holds no mutable state, so every method re-reads and stale reads
are impossible (the agent's in-session writes and the UI's edits converge on the same file). Robust by
construction: a missing or corrupt file reads as an empty list, and unknown/invalid fields are dropped on
read (`sanitize`), so a hand-edited file never crashes a session.

**Artifacts.** An item may carry `artifacts` — links to what the work produced: `kind: "file" | "change"
| "spec"`, a worktree-relative `path`, an optional `label`, and (spec only) a durable graph `specId`.
The model just stores them; it does not resolve paths or compute diffs. `file`/`spec` are attached by the
agent (a `spec` naturally from `spec_create`'s `{path,id}`); `change` artifacts are attached by the host
when an item reaches `done` (see `server/src/todos` — the store stays git-free). The on-disk `version` is
`3`; a `version: 2` file (no `artifacts`) reads cleanly and is upgraded on the next write.

## Public surface

The `index.ts` barrel:
- `TodoStore` (constructed per `(root, sessionId)`), `STORE_DIR` / `storeRel`, and the `countItems(plan)`
  helper.
- The model types: `Todo`, `TodoGroup`, `TodoPlan`, `TodoFile`, `TodoInput`, `TodoPatch`, `WriteItem`,
  `WritePlan`, `TodoArtifact`, and the `TodoStatus` / `TodoOrigin` / `TodoArtifactKind` aliases.
- The `TODO_STATUSES` (`pending | in_progress | done`) and `TODO_ORIGINS` (`agent | user`) tuples — the
  single source for the tools' param enums. (There is **no** priority concept; priorities were dropped.)

Writes are atomic (temp file + `rename`); a session id is validated as a safe path segment before it
becomes a filename, and `\uXXXX` escape-decoding is applied to **agent-authored** text only, never the
user's own input.

## Boundary

- **Allowed deps:** Node built-ins only (`node:fs`, `node:path`, `node:crypto`).
- **Forbidden:** any `@earendil-works/*` **and any `@thinkrail/*`** import — this is the pi-free,
  thinkrail-free layer the host can value-import without pulling pi into its bundle, and that stays
  installable under vanilla `pi`. Consequence: `STORE_DIR` (`.thinkrail/context/todos`) carries a **local
  mirror** of `@thinkrail/shared`'s `WORKSPACE_CONTEXT_DIR` rather than importing it — the shared constant
  is the host-side source of truth; keep the two in step. `tools/` imports this through the barrel;
  nothing here imports `tools/`.
