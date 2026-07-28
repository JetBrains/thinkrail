---
id: module-pi-todos
type: module-design
status: draft
title: pi-todos extension — the chat TODO list
parent: architecture
depends-on: []
references: [module-spec-graph, submodule-web-chat]
tags: [pi-extension, todos, v2]
---

## Responsibility

`pi-todos` is a portable pi-package that gives the `pi` agent a **chat-scoped TODO list** — its working
plan for the conversation, which the user can also add to. It is the *engine* behind the chat's TODO
plan UX ([[submodule-web-chat]]'s "Chat TODO plan"), modeled on [[module-spec-graph]]: a skill, five `todo_*` custom tools, and one `before_agent_start` rule.

- **`index.ts`** — an `ExtensionFactory` registering the five tools and one always-on `before_agent_start`
  rule. The rule is deliberately **short and byte-stable** — awareness that a shared list + `todo_*` tools
  exist, plus a pointer to the todos skill. The lever is *understanding*, not prompt volume: **how to work
  with the list lives in the skill; each tool's invariants live in its own description.** (We tried
  injecting the live list into every prompt and pulled it back — the tools + skill carry it instead.)
- **`core/`** — the pi-free model ([[submodule-pi-todos-core]]): the `Todo` types and the per-session
  `TodoStore` (read-modify-write `.thinkrail/context/todos/<sessionId>.json`). No `@earendil-works/*` imports, so
  the host can value-import `pi-todos/core` to power the plan viewer — reading the plan and writing the
  user's own edits (the `spec/` → `spec.graph` pattern).
- **`tools/`** — the five `todo_*` custom tools ([[submodule-pi-todos-tools]]), thin wrappers over `core/`.
- **`skills/todos/SKILL.md`** — the bundled skill: the chat-plan discipline — group = task (one user
  ask, outcome-titled; 1–7 verifiable, ≈commit-sized steps), work tasks strictly in order with one step
  `in_progress` (blocked task = note why, tell the user, move on), fold in the user's mid-conversation
  additions.

## The tools

| Tool | Purpose |
| --- | --- |
| `todo_list` | Read the current plan, rendered **group-first** (each group under a derived status + done/total header), optionally filtered by status. |
| `todo_add` | Add one item — into a `group`, or `after` an existing item (**one of the two is required**: the agent can't author loose items). |
| `todo_update` | Change an item's status / title / note / artifacts — how the agent flips `pending → in_progress → done`. Reports auto-demoted (`paused`) items; a `done` flip suggests the group's next open step. |
| `todo_remove` | Drop an item. |
| `todo_write` | Replace the agent's plan with fresh **groups only** — one group per task, steps inside (the plan-first pattern). |

**Group = task.** The plan's model is two-level: a group is one user ask (title = the outcome), its
items are the steps. A group's own status is **derived, never stored** (`groupStatus` in `core/`:
all done → `done`, any in_progress → `active`, else `pending`), so it can't drift from the steps. The host
reads it through this helper and ships it on the wire DTO (`TodoGroupItem.status`), so no client re-derives
it — one truth table, one home.
Two invariants are held structurally, not by model memory: **exactly one `in_progress` across the
plan** (setting it auto-demotes the previous one back to `pending` — reported in the result as
"paused"), and **the agent never authors loose items** (the tools require `group`/`after`; loose is
the user's lane). Status discipline gets in-band feedback: tool results append a nudge when open items
exist but nothing is `in_progress`, and a `done` flip names the task's next open step — suggest-only,
never auto-started (that would fake "in work" when the agent stops).

The tool resolves its list from `ctx.sessionManager.getSessionId()`, so it always reads/writes the list
of the conversation it runs in.

## Scope & persistence — one list per chat

The list is **scoped to a chat session**, not the worktree: one JSON file per session,
`.thinkrail/context/todos/<sessionId>.json` under the worktree root — inside the ephemeral `context/`
scratch dir the host seeds and git ignores, so the plans live alongside the other per-conversation
working files. It is the agent's working plan for that conversation; the user can add items to it (from
the UI), and the agent picks them up on its next turn (`todo_list`). The file is the source of truth —
`TodoStore` re-reads it on every op — so the agent's in-session writes and the user's UI edits converge
with no staleness window; a missing or corrupt file reads as an empty list. Ephemeral per chat
(gitignored), not committed with the repo.

## Status ownership & provenance

Status is **agent-owned**: the agent flips `pending → in_progress → done` via `todo_update` as it works
its plan (the store auto-demotes a previous `in_progress` on each new one). The current UI never
toggles status — its edit surface is only add / remove. (The `todo.update`
wire method exists and accepts a status, but no UI path calls it today; it's reserved, not the user's
lever.)

Each item carries an **`origin`** (`agent` | `user`) — UI adds are `user`, the agent's tools write
`agent`. This is a **structural guard, not just guidance**: `todo_write` (the agent re-laying its plan)
**preserves `user` items and any `done` item**, replacing only the agent's own open items — so a re-plan
can never drop the user's requests or the completed history. The UI marks `user` items so the human sees
which are theirs.

## Artifacts

An item may link to what it produced via **`artifacts`** — `kind: "file" | "change" | "spec"`, a
worktree-relative `path`, an optional `label`, and (spec only) a durable `specId`. Ownership splits by
kind: the **agent** attaches `file`/`spec` through the tools (a `spec` from `spec_create`'s `{path,id}`);
**`change` is host-owned** — the host attaches it automatically when the agent marks an item `done`
(the files changed during the step, see [[submodule-server-todos]]). The pi-free `core`/`tools` never
touch git — they just store whatever artifacts they're handed; the diff of a `change` is computed live in
the UI, not persisted. The on-disk file `version` is `3` (a `2` file with no artifacts upgrades on write).

## Boundary

- **Allowed deps:** `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai/compat` (`StringEnum`) —
  **types/compat only**, as peer deps — and `typebox`, and Node built-ins (`node:fs`/`node:path`/
  `node:crypto`). `core/` uses Node built-ins only.
- **Forbidden:** any `@thinkrail/*` package, `apps/web`, `packages/server` internals — reached only by
  tool *name*, never by import. The host reaches this package one way only: `pi-todos/core`
  (value-import, pi-free) for the viewer, plus the extension entry via `additionalExtensionPaths`.
- **Portable.** Unlike `pi-thinkrail-workflow`, this package assumes no thinkrail-only host tool; it runs
  under vanilla pi (`pi install`) and in thinkrail alike.

## thinkrail integration

`packages/server/src/agent/extensions.ts` adds this package the same way as `pi-spec-graph`:
`require.resolve("pi-todos/index.ts")` on `additionalExtensionPaths`, its `skills/` dir on
`additionalSkillPaths`; `packages/server/package.json` carries `"pi-todos": "workspace:*"`; and the
compiled-binary generator (`apps/cli/scripts/build-binary.ts`) bundles it as a value-imported factory for
parity.

## Testing

`core/core.test.ts` pins the store's contract against a real temp dir (add/update/list/remove/replaceAll,
per-session isolation, plus the corrupt-file and invalid-item degradation).
`tools/tools.test.ts` drives each tool's `execute` against a temp cwd through a fake `ExtensionAPI` (with
a stub `sessionManager.getSessionId`) — param plumbing, the error-on-unknown-id path, and that
finite-vocabulary params derive their enums from the core tuples.
