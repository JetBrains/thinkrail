---
id: submodule-pi-todos-tools
type: submodule-design
status: draft
title: pi-todos tools (pi wrappers)
parent: module-pi-todos
depends-on: [submodule-pi-todos-core]
tags: [pi-extension, todos]
---

## Responsibility

The six `pi` custom tools that expose the backlog to the agent — `todo_list`, `todo_add`, `todo_update`,
`todo_remove`, `todo_write`, `todo_plan_summary`. Each is a **thin wrapper** over `core/`: a TypeBox `parameters` schema, an
`execute` that calls one `TodoStore` method against `ctx.cwd`, and a `textResult`/`errorResult` return.
The finite-vocabulary `status` param derives its enum from the `core/` tuple via
`StringEnum`, so the schema and the model move together (pinned by `tools.test.ts`).

**This layer is where the agent-facing constraints live** (core stays permissive — both the user lane
and the host wire use loose items, and the agent can author loose too):
- **Loose authoring is a scratchpad, not a plan surface:** `todo_write`'s schema offers `groups` only,
  so a re-plan never mints or edits loose items. `todo_add` accepts `group`, `after`, or **neither** —
  omitting both drops a raw loose item into the shared pre-work queue the user and agent share; the
  skill carries the promote-on-work discipline (take a loose item into work by authoring a group with a
  proper title + steps, then removing the raw loose item). An `after` anchored to a loose item is
  **rejected**: loose items are promoted into a group, not grown with siblings, so inheriting the
  anchor's lane would misrepresent intent. `TodoStore.add` stays permissive because the host writes the
  user's own loose lane through it.
- **`todo_write` reconciles, it never destructively replaces:** the tool forwards its `groups` to
  `TodoStore.replaceAll`, which matches written steps to existing ones by group + step title and keeps
  their progress (see [[submodule-pi-todos-core]]). So a mid-task re-plan is safe and lossless — there is
  **no runtime nudge** discouraging it; the todos skill carries the (efficiency-only) preference for
  `todo_add`/`todo_update` on a single change.
- **In-band nudges** (the status-discipline feedback): every mutating/list result appends
  `consistencyNudge` when open items exist but none is `in_progress`; a `todo_update` → `done` names
  the group's next open step instead (suggest-only, never auto-started); auto-demoted items are
  reported as `(paused: …)`. A `done` that leaves **no open item anywhere** additionally nudges
  `todo_plan_summary` — the overall completion summary is asked for at exactly the moment it becomes due;
  when a summary from an earlier completion still survives on the plan (the add-new-work path never drops
  it), the nudge **echoes that text and asks the agent to extend it** rather than rewrite from scratch, so
  the note stays cumulative over everything done instead of narrowing to the last step.
- **Completion summaries (the review trail):** `todo_update` takes optional `summary` (what/why — the
  decisions the diff can't show, plus any scope drift; **structured Markdown** — lead + bullets),
  **`commitSubject`** (the git-facing subject line
  for the step's delta, written in the host repository's own commit style — the schema description is
  where the "read `git log` and match it" instruction lives, since the tools are the agent's only
  contact with this field) and **`verification`** (the exact check(s) run +
  result, or "not verified" — a separate field so the UI badges it with a status glyph; **Markdown**, so
  several checks render as a bullet list rather than one `;`-crammed line, and a vague or missing line is
  visible at a glance) — all three set together with `status: done` (skill-mandated for
  code-changing steps, never a tool gate: the tool can't know whether the step changed code — git
  lives host-side). `todo_plan_summary` sets the plan-level handoff note
  (`TodoStore.setSummary`) — a **cumulative** recap of everything done across the whole plan (every task,
  every completion), extended not rewritten when an earlier note survives; it accepts an early call but
  flags how many items are still open (the UI shows the note only once everything is done).
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
