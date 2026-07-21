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
list stored as one file, `.thinkrail/todos/<sessionId>.json`, read and written by read-modify-write. The
file is the source of truth; the store holds no mutable state, so every method re-reads and stale reads
are impossible (the agent's in-session writes and the UI's edits converge on the same file). Robust by
construction: a missing or corrupt file reads as an empty list, and unknown/invalid fields are dropped on
read (`sanitize`), so a hand-edited file never crashes a session.

## Public surface

The `index.ts` barrel:
- `TodoStore` (constructed per `(root, sessionId)`), `STORE_DIR` / `storeRel`, and the `countItems(plan)`
  helper.
- The model types: `Todo`, `TodoGroup`, `TodoPlan`, `TodoFile`, `TodoInput`, `TodoPatch`, `WriteItem`,
  `WritePlan`, and the `TodoStatus` / `TodoOrigin` aliases.
- The `TODO_STATUSES` (`pending | in_progress | done`) and `TODO_ORIGINS` (`agent | user`) tuples — the
  single source for the tools' param enums. (There is **no** priority concept; priorities were dropped.)

Writes are atomic (temp file + `rename`); a session id is validated as a safe path segment before it
becomes a filename, and `\uXXXX` escape-decoding is applied to **agent-authored** text only, never the
user's own input.

## Boundary

- **Allowed deps:** Node built-ins only (`node:fs`, `node:path`, `node:crypto`).
- **Forbidden:** any `@earendil-works/*` import — this is the pi-free layer the host can value-import
  without pulling pi into its bundle. `tools/` imports this through the barrel; nothing here imports
  `tools/`.
