---
id: submodule-server-todos
type: submodule-design
status: active
title: todos — a chat's per-session TODO plan (read/write)
parent: module-server
depends-on: [module-contracts, submodule-server-git]
references: [module-pi-todos, submodule-web-chat]
tags: [v2, todos]
---

## Responsibility

Serve the in-chat TODO plan for a chat session, mapped to the wire DTOs. The list is **scoped by
`sessionId`** (one JSON file per session under the workspace's worktree, in the ephemeral context scratch
dir `.thinkrail/context/todos/<sessionId>.json`), not the worktree. Read-modify-write on demand: every call re-reads
through `pi-todos`' pi-free `TodoStore`, so the agent's in-session `todo_*` writes and the user's UI edits
converge on the same file with no staleness window.

Unlike the agent's own tools (which own status), the host's write surface is the **user's** edit lever:
`todo.add` tags new items `origin: "user"` so the agent's `todo_write` re-plans never drop them, and
`todo.remove` deletes by id. `todo.update` exists on the wire (accepts status/title/note) but no current
UI path calls it — status stays agent-owned (see [[module-pi-todos]]).

This module does **not** push: a user edit isn't broadcast to other clients. The acting client updates
optimistically; a second viewer reconciles on the next `pi.event`-driven refetch. Fine for single-owner
V1 (the chat-plan UX this feeds: [[submodule-web-chat]]'s "Chat TODO plan").

**Change artifacts (`artifacts.ts`).** Status stays agent-owned, but the host *observes* the transitions
to attach an item's code changes. `host/server.ts` tees `isTodoToolEnd` off the session event stream and
defers `maybeAttachChangeArtifacts(workspaceId, sessionId)` (it runs git, off the publish path). On
`in_progress` it snapshots the worktree's changed-path set (a baseline, in-memory — a restart loses it
and `done` falls back to the whole current set); on `done` it writes `change` artifacts for the paths
changed since that baseline, via `git` (`gitStatus`) — the pi-free `TodoStore` never touches git. It
merges (keeps the agent's `file`/`spec` artifacts) and is idempotent (skips an item already carrying a
`change`). The host's own on-disk state (anything under `WORKSPACE_INTERNAL_DIR` = `.thinkrail/…`, e.g.
the todos JSON under `context/todos/`) is filtered out of the change set — writing a todo shows up in
`git status` but is never a change the step *produced*. The
agent attaches `file`/`spec` artifacts itself through the `todo_*` tools (see [[module-pi-todos]]);
`change` is host-only.

## Boundary

- **Owns / public surface (barrel):** `listTodos({workspaceId, sessionId}) → TodoPlan`,
  `addTodo(...) → TodoItem` (validates a non-empty title; tags `origin: "user"`),
  `updateTodo(...) → TodoItem` (throws on unknown id → a `{ ok:false }` WS response),
  `removeTodo(...) → { ok:true }` (idempotent). **Mapping only** — no plan logic; `TodoStore` owns disk.
- **Allowed deps:** `workspaces` (worktree-path lookup via `getWorkspace`, which throws on unknown);
  `git` (`gitStatus` — the changed-path set for `change` artifacts); `contracts` (DTOs + `PiEvent` for
  `isTodoToolEnd`); `@thinkrail/shared/paths` (`WORKSPACE_INTERNAL_DIR` — the app-state prefix filtered
  out of `change` artifacts); **`pi-todos/core`** (the pi-free read/write model — a sanctioned host-side
  value-import of the extension package, the same pattern as `spec` → `pi-spec-graph/core`).
- **Forbidden:** `host`; sibling features other than `workspaces` + `git`; `pi-todos`' extension entry or
  `tools/` (pi-coupled); any pi package.
