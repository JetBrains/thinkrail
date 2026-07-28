---
name: todos
description: "This chat has a shared, live TODO plan — your tasks for the conversation, which the user also edits. Read this skill and reach for the todo_* tools whenever a request takes more than a couple of steps. It covers the plan model (group = task, items = its steps; loose items are the user's lane), how to work it: propose the plan FIRST (todo_write before you ask questions or start work), work tasks strictly in order with one step in_progress, keep statuses current, re-read the list (source of truth) to catch the user's edits, respect removals, and never delete done items."
---

# Chat TODO plan

## What it is

- A plan **scoped to this chat** — your tasks for the conversation. Shown to the user in the Todo
  panel; lives with the session (not committed to the repo).
- **Group = task, item = step.** One user ask = one group; its title is the *outcome* ("Fix login
  redirect"), not the process. The steps inside are the items — each has a **title**, a **status**
  (`pending` → `in_progress` → `done`), and an optional **note** (put the done-criterion there, e.g.
  "login e2e green"). A task's own status is never stored — it derives from its steps.
- **Loose items are the user's lane — and they sit at the END of the plan.** They hold what the
  **user** adds from the UI; you work them, but never group, rewrite, or drop them. `todo_list` renders
  them **last**, after every group, on purpose: a request the user adds mid-task queues *after* your
  current work. So **finish (or resume) the task you're on before you pick up a loose item** — don't
  jump to a freshly-added user item and abandon a step you had in progress. You don't author loose
  items (the tools require a `group` or an `after` anchor); a tiny ask is a small group (1–2 steps is
  fine), or no list at all.
- It is **shared and live**: you maintain it, and the **user edits it while you work** — adding tasks,
  removing ones they've dropped. The stored list is the **source of truth**; what you remember is only
  a snapshot. **Re-read it (`todo_list`)** to stay in sync, don't trust your memory of it.
- It is **the user's status window** — how they follow what's happening at a glance, without reading
  the chat. Short, concrete step titles; statuses always current.

## Granularity

| Size of the ask | Shape in the plan |
| --- | --- |
| Trivial (an answer, one edit) | no list at all |
| 1–7 steps | one group (a small ask = a 1–2-step group, that's fine) |
| more than ~10 steps | those aren't steps, they're tasks — split into several groups |

Steps are **verifiable** and ≈ commit-sized: "easy to check off as you go", not "phase 1".

## Working with it

1. **Propose the plan first — it's the point of the list.** The moment you understand a request that
   takes more than a couple of steps, your first action is **`todo_write`** with your proposed plan —
   one group per task, steps inside — **before** you ask clarifying questions and **before** you start
   the work. Then refine it in place as you learn more. (A one-shot answer needs no list.)
2. **Work tasks strictly in order, one step at a time:**
   - Flip a step to `in_progress` when you start it, `done` when you finish. Starting a new step
     auto-returns any other `in_progress` step to `pending` — so finish (mark `done`) before moving on,
     or the previous step visibly falls back to open.
   - Don't start the next group while the current one has open steps. The one exception: a genuinely
     **blocked** task — record why in the step's `note`, tell the user, and move on to the next group.
   - **Before each next step, `todo_list` again.** The user may have edited mid-work: note anything
     new (it's appended in the user's lane at the **end** — take it up *after* the step you're on, don't
     preempt in-progress work), and if an item you planned is gone, they dropped it — **skip it, don't
     re-add it**.
   - The tool results help you: after a `done` they name the task's next step; when nothing is
     `in_progress` they remind you to flip the step you're on. Act on those nudges.
3. **A new ask mid-session = a new group appended** (`todo_add` with `group:`, one per step — or lay
   out the new task's steps with several `todo_add` calls). Never mix a new ask's steps into the
   current group. **A step you discover mid-task** slots in with `todo_add after: <current step id>` (anchor to one of *your* steps — anchoring to one of the user's own items is rejected, since your items never live in their lane) —
   don't rebuild the plan with `todo_write` for that.
4. **Reconcile before you finish.** At the end of a turn, `todo_list` once more. If open steps remain
   (including items the user just added), either do them or clearly say what's left and why — don't go
   idle silently leaving fresh items untouched.

## Invariants

- **Done stays.** Completing a step = `todo_update` → `done`. **Never delete a done item** — it's the
  user's history. `todo_remove` is only for when the user explicitly asks to drop something.
- **Edit surgically.** After the first plan, use `todo_update` / `todo_add` (they touch one item).
  **Never `todo_write` to tweak** an existing list — it replaces everything; `todo_write` is only for
  laying out a fresh plan.
- **Respect the user's edits.** The list is shared; treat their additions as new requests and their
  removals as cancellations. Loose items are theirs — do them, but don't rewrite or drop them when you
  re-plan. (`todo_write` preserves user items and done items for you, but don't lean on that — reach
  for `todo_add`/`todo_update` to edit, and keep `todo_write` for a genuinely fresh plan.)

## Tools

- `todo_list` — read the current plan (the source of truth; re-read to catch the user's edits).
- `todo_add` — add one step (into a `group`, or `after` an existing step; leaves the rest untouched).
- `todo_update` — progress one step (`in_progress` on start, `done` when finished; done stays).
- `todo_remove` — delete one item (only when the user asks).
- `todo_write` — lay out a fresh plan (groups only — one per task; replaces your open items; use once,
  at the start).
