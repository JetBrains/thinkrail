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

`shared.ts` holds `storeFor(ctx)` (a fresh `TodoStore` for the active `(ctx.cwd, sessionId)` — the store
is stateless, so there is no cache), the result helpers, and `formatTodo` (the one-line rendering used in
tool output).

## Public surface

The `index.ts` barrel: `registerTodoTools(pi)`, the sole entry point, called by the extension entry
(`../index.ts`).

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent` (types), `@earendil-works/pi-ai/compat`
  (`StringEnum`), `typebox`, and `../core` (through its barrel).
- **Forbidden:** reaching into `core/` internals (import via the barrel), any `@thinkrail/*` package, and
  any filesystem access outside `TodoStore` — the store owns disk.
