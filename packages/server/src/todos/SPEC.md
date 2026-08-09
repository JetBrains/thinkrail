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
converge on the same file with no staleness window. `listTodos` also **decorates each group with its
derived `status`** (`pi-todos`' `groupStatus`) on the way out: the rule belongs to the package that owns plan
semantics, and shipping the result keeps `apps/web` — which may import `contracts` only — from carrying a
second copy of it.

Unlike the agent's own tools (which own status), the host's write surface is the **user's** edit lever:
`todo.add` tags new items `origin: "user"` so the agent's `todo_write` re-plans never drop them, and
`todo.remove` deletes by id. `todo.update` exists on the wire (accepts status/title/note) but no current
UI path calls it — status stays agent-owned (see [[module-pi-todos]]). `updateTodo` unwraps the store's
`TodoUpdateResult` (`{ todo, paused }` — `paused` = items auto-demoted to keep one `in_progress`); the
wire response stays a bare `TodoItem` — the UI re-reads the whole plan on change, so demotions arrive
with the next `todo.list`.

This module does **not** push: a user edit isn't broadcast to other clients. The acting client updates
optimistically; a second viewer reconciles on the next `pi.event`-driven refetch. Fine for single-owner
V1 (the chat-plan UX this feeds: [[submodule-web-chat]]'s "Chat TODO plan").

**Change artifacts (`artifacts.ts`) — a commit-based review map.** Status stays agent-owned, but the host
*observes* the transitions to attach an item's code changes, so the plan becomes a durable review map.
`host/server.ts` tees `isTodoToolEnd` off the session event stream and fires
`maybeAttachChangeArtifacts(workspaceId, sessionId)` off the publish path (`void` — it runs git writes).
Reconciles are **serialized per workspace** (a promise chain) so two quick `todo_*` ends can't race the
index mid-commit; the whole path is best-effort and never throws into the event stream.

On `in_progress` it snapshots the worktree's **uncommitted** changed-path set + the current `HEAD` sha
(a baseline, **persisted** in a host-owned sidecar next to the todos JSON —
`.thinkrail/context/todos/<sessionId>.baselines.json`, read-modify-write like the store — so a host
restart mid-item changes nothing; `head` is recorded for future window-commit attribution, unused today).
On `done`:

- **Commit the item's work.** `git.gitCommitAll` stages everything except `.thinkrail/` (`git add -A -- .
  ':!.thinkrail'` — the host's todos JSON is never swept into the user's history), commits it
  `--no-verify` (the bookkeeping commit must not run/fail the user's hooks; author/committer stay the
  user's own config — it's their branch) with a `todo: <title>` subject + a `ThinkRail-Todo:
  <sessionId>/<todoId>` trailer (recoverable/squashable by tooling). The item gets **one `commit`
  artifact** (the sha, `label` = the item title) and **nothing else**: the commit is self-sufficient —
  its file list is *derived*, never denormalized into the JSON (see the `listTodos` decoration below).
- **Commit gate (safety on the user's branch).** Commit only when **no foreign dirt remains**: every path
  already dirty at the item's baseline must be clean again by `done` (or the baseline was empty; a
  *missing* baseline — an item that predates the sidecar — counts as empty). Foreign dirt present → **no
  commit**; fall back to the live-diff `change` path-list artifacts (branch scope) — `change` survives
  **only** as this fallback. This quietly disables auto-commit in a Default workspace holding the user's
  WIP, which is the intended guard. Because each committed item leaves the uncommitted set, sequential
  commits attribute overlapping items cleanly with no extra bookkeeping.
- **Merge + replace-on-redo.** The agent's `file`/`spec` artifacts are always kept. A `done` item already
  carrying a change set with **no fresh baseline** is a steady-state no-op (idempotent); a re-opened,
  re-worked item (fresh baseline present) has its old `commit`/`change` artifacts **replaced** with the
  new ones (the old commit stays in branch history regardless).

The host's own on-disk state (anything under `WORKSPACE_INTERNAL_DIR` = `.thinkrail/…`, e.g. the todos
JSON under `context/todos/`) is filtered out of every change set — writing a todo shows up in `git status`
but is never a change the step *produced*. The pi-free `TodoStore` never touches git; `commit`/`change`
are host-only, while the agent attaches `file`/`spec` itself through the `todo_*` tools (see
[[module-pi-todos]]). Known limitation (accepted): an agent that commits *itself* mid-item leaves an empty
delta at `done` → no artifacts.

**`listTodos` decoration — unfolding the commit.** The wire DTO's `commit` artifact carries a derived
**`files`** list — full `GitFileChange[]` rows (path + status + `+/−` line counts), read through
`git.gitStatus` at the **`commit:{sha}` scope** (the exact rows the Changes panel renders there, one
derivation) — memoized in-memory **by sha** — immutable, so the cache never staleness-checks; only
successful resolutions are cached, a transient git failure (or `UNKNOWN_COMMIT`) retries on the next
list. An **unresolvable sha** (GC'd after a history rewrite — reflog keeps rewritten commits alive ~90
days, far longer than a chat plan's ephemeral life; we deliberately pin nothing) yields **no `files`** —
that absence is the client's signal to degrade the affordance silently (no chip, never a broken diff
tab). The same decoration pass is where `groupStatus` already ships, so the pattern has one home.

## Boundary

- **Owns / public surface (barrel):** `listTodos({workspaceId, sessionId}) → TodoPlan`,
  `countOpenTodos({workspaceId, sessionId}) → number` + its pure rule `openTodoCount(plan)` (unfinished =
  any status but `done`, loose + grouped — the `SessionSummary.openTodos` decoration the host's
  `session.list` handler attaches so a client can auto-open chats with work in progress; a session with
  no todo file counts 0),
  `addTodo(...) → TodoItem` (validates a non-empty title; tags `origin: "user"`),
  `updateTodo(...) → TodoItem` (throws on unknown id → a `{ ok:false }` WS response),
  `removeTodo(...) → { ok:true }` (idempotent). **Mapping only** — no plan logic; `TodoStore` owns disk.
- **Allowed deps:** `workspaces` (worktree-path lookup via `getWorkspace`, which throws on unknown);
  `git` (`gitStatus` — the uncommitted changed-path set + the commit-scope DTO decoration;
  `gitCommitAll` — the per-done-item commit; `gitHeadSha` — the baseline's head);
  `contracts` (DTOs + `PiEvent` for `isTodoToolEnd`); `@thinkrail/shared/paths` (`WORKSPACE_INTERNAL_DIR`
  — the app-state prefix filtered out of change sets); **`pi-todos/core`** (the pi-free read/write model — a sanctioned host-side
  value-import of the extension package, the same pattern as `spec` → `pi-spec-graph/core`).
- **Forbidden:** `host`; sibling features other than `workspaces` + `git`; `pi-todos`' extension entry or
  `tools/` (pi-coupled); any pi package.
