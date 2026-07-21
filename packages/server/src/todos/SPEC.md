---
id: submodule-server-todos
type: submodule-design
status: active
title: todos — a chat's per-session TODO plan (read/write)
parent: module-server
depends-on: [module-contracts]
references: [module-pi-todos, design-todos]
tags: [v2, todos]
---

## Responsibility

Serve the in-chat TODO plan for a chat session, mapped to the wire DTOs. The list is **scoped by
`sessionId`** (one JSON file per session under the workspace's worktree,
`.thinkrail/todos/<sessionId>.json`), not the worktree. Read-modify-write on demand: every call re-reads
through `pi-todos`' pi-free `TodoStore`, so the agent's in-session `todo_*` writes and the user's UI edits
converge on the same file with no staleness window.

Unlike the agent's own tools (which own status), the host's write surface is the **user's** edit lever:
`todo.add` tags new items `origin: "user"` so the agent's `todo_write` re-plans never drop them, and
`todo.remove` deletes by id. `todo.update` exists on the wire (accepts status/title/note) but no current
UI path calls it — status stays agent-owned (see [[module-pi-todos]]).

This module does **not** push: a user edit isn't broadcast to other clients. The acting client updates
optimistically; a second viewer reconciles on the next `pi.event`-driven refetch. Fine for single-owner
V1 (see [[design-todos]]).

## Boundary

- **Owns / public surface (barrel):** `listTodos({workspaceId, sessionId}) → TodoPlan`,
  `addTodo(...) → TodoItem` (validates a non-empty title; tags `origin: "user"`),
  `updateTodo(...) → TodoItem` (throws on unknown id → a `{ ok:false }` WS response),
  `removeTodo(...) → { ok:true }` (idempotent). **Mapping only** — no plan logic; `TodoStore` owns disk.
- **Allowed deps:** `workspaces` (worktree-path lookup via `getWorkspace`, which throws on unknown);
  `contracts` (DTOs); **`pi-todos/core`** (the pi-free read/write model — a sanctioned host-side
  value-import of the extension package, the same pattern as `spec` → `pi-spec-graph/core`).
- **Forbidden:** `host`; sibling features other than `workspaces`; `pi-todos`' extension entry or
  `tools/` (pi-coupled); any pi package.
