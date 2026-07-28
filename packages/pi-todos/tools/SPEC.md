---
id: submodule-pi-todos-tools
type: submodule-design
status: draft
title: pi-todos tools (pi wrappers)
parent: module-pi-todos
depends-on: [submodule-pi-todos-core]
tags: [pi-extension, todos, v2]
---

## Responsibility

The five `pi` custom tools that expose the backlog to the agent — `todo_list`, `todo_add`, `todo_update`,
`todo_remove`, `todo_write`. Each is a **thin wrapper** over `core/`: a TypeBox `parameters` schema, an
`execute` that calls one `TodoStore` method against `ctx.cwd`, and a `textResult`/`errorResult` return.
The finite-vocabulary `status` param derives its enum from the `core/` tuple via
`StringEnum`, so the schema and the model move together (pinned by `tools.test.ts`).

**This layer is where the agent-facing constraints live** (core stays permissive — the user lane and
the host wire still use loose items):
- **No loose authoring:** `todo_write`'s schema offers `groups` only; `todo_add` errors unless `group`
  or `after` is given (`after` = insert after that item, in its lane; wins over `group`).
- **In-band nudges** (the status-discipline feedback): every mutating/list result appends
  `consistencyNudge` when open items exist but none is `in_progress`; a `todo_update` → `done` names
  the group's next open step instead (suggest-only, never auto-started); auto-demoted items are
  reported as `(paused: …)`.
- **Group-first output:** `formatPlan` renders each group under `formatGroupHeader` — `▸ <title>
  [<derived status> <done>/<total>]` — with its steps indented, **then the loose lane (the user's own
  adds) last** under a `Your requests:` header. The user's lane is last on purpose: a request added
  mid-task queues *after* the agent's current work, so reading top-to-bottom resumes/finishes the
  active task first. Same two-level order the user sees (`TodoList`) and `flat()`/`list()` return.

`shared.ts` holds `storeFor(ctx)` (a fresh `TodoStore` for the active `(ctx.cwd, sessionId)` — the store
is stateless, so there is no cache), the result helpers, `formatTodo`/`formatGroupHeader`/`formatPlan`
(the rendering used in tool output), and `consistencyNudge`/`withNudges`.

## Public surface

The `index.ts` barrel: `registerTodoTools(pi)`, the sole entry point, called by the extension entry
(`../index.ts`).

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent` (types), `@earendil-works/pi-ai/compat`
  (`StringEnum`), `typebox`, and `../core` (through its barrel).
- **Forbidden:** reaching into `core/` internals (import via the barrel), any `@thinkrail/*` package, and
  any filesystem access outside `TodoStore` — the store owns disk.
