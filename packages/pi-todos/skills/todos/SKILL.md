---
name: todos
description: "This chat has a shared, live TODO list — your current plan, which the user also edits. Read this skill and reach for the todo_* tools whenever a request takes more than a couple of steps. It covers how to work with it: propose the plan FIRST (todo_write before you ask questions or start work — it's the living plan, not a post-approval checklist), refine it in place, keep status current, re-read the list (source of truth) to sync with the user's edits, respect removals, and never delete done items."
---

# Chat TODO list

## What it is

- A checklist **scoped to this chat** — your working plan for the conversation. Shown to the user in the
  Todo panel; lives with the session (not committed to the repo).
- Each item has a **title**, a **status** (`pending` → `in_progress` → `done`), and an optional **note**.
- The plan is **loose items** (standalone tasks) plus optional named **groups**. When the work splits
  into distinct threads/areas, give `todo_write` a **`group`** (a title + its own list of items) — author
  the group as a whole, don't tag each item. `todo_add` takes an optional `group` to slot one in (created
  if new). A simple plan is just loose items, no groups. **The user's own items always stay loose** — you
  work them, but never fold them into a group or drop them.
- It is **shared and live**: you maintain it, and the **user edits it while you work** — adding tasks,
  removing ones they've dropped. So the stored list is the **source of truth**; what you
  remember is only a snapshot. **Re-read it (`todo_list`)** to stay in sync, don't trust your memory of it.
- It is **the user's status window** — how they follow what's happening at a glance. Write short, concrete
  item titles, and keep statuses current, so the list always reflects reality without them asking.

## Working with it

1. **Propose the plan first — it's the point of the list.** The moment you understand a request that
   takes more than a couple of steps (research, a multi-file change, distinct sub-tasks), your first
   action is **`todo_write`** with your proposed ordered plan — **before** you ask clarifying questions
   and **before** you start the work. The list is your *current plan*, shown to the user as you form it,
   not a checklist you backfill once the plan is approved. Then refine it in place: as you learn more,
   ask questions, or the user steers, update the items so the list always reflects what you now intend to
   do. (A one-shot answer or single edit needs no list.)
2. **Work the loop, syncing as you go:**
   - `todo_update` an item to `in_progress`, do it, then `done`. Keep status honest — it's the user's
     only window into your progress.
   - **Before each next item, `todo_list` again.** The user may have edited mid-work: pick up anything
     new, and if an item you planned is gone, they dropped it — **skip it, don't re-add it**.
3. **Reconcile before you finish.** At the end of a turn, `todo_list` once more. If pending items remain
   (including ones the user just added), either do them or clearly say what's left and why — don't go
   idle silently leaving fresh items untouched.

## Invariants

- **Done stays.** Completing an item = `todo_update` → `done`. **Never delete a done item** — it's the
  user's history. `todo_remove` is only for when the user explicitly asks to drop something.
- **Edit surgically.** After the first plan, use `todo_update` / `todo_add` (they touch one item).
  **Never `todo_write` to tweak** an existing list — it replaces everything and erases done items;
  `todo_write` is only for laying out a fresh plan.
- **Respect the user's edits.** The list is shared; treat their additions as new requests and their
  removals as cancellations. Items the user added are theirs — do them, but don't rewrite or drop them
  when you re-plan. (`todo_write` preserves user items and done items for you, but don't lean on that —
  reach for `todo_add`/`todo_update` to edit, and keep `todo_write` for a genuinely fresh plan.)

## Tools

- `todo_list` — read the current list (the source of truth; re-read to catch the user's edits).
- `todo_add` — append one item (leaves the rest, incl. done, untouched).
- `todo_update` — progress/edit one item (`in_progress` on start, `done` when finished; done stays).
- `todo_remove` — delete one item (only when the user asks).
- `todo_write` — lay out a fresh plan (replaces the whole list — use once, at the start).
