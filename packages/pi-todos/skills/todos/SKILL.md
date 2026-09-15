---
name: todos
description: "Use when the user asks for a shared plan, a task needs at least three substantive execution steps, or a user-origin TODO is pending. Without an explicit plan request, not for one-shot answers or checks, or one- to two-step work that is not already in the list."
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
  items (the tools require a `group` or an `after` anchor). An ordinary 1–2-step chat ask gets a group
  only when the user explicitly requested a plan; a pending loose item is already in the plan, so work
  and complete that exact item with `todo_update` regardless of its size.
- It is **shared and live**: you maintain it, and the **user edits it while you work** — adding tasks,
  removing ones they've dropped. The stored list is the **source of truth**; what you remember is only
  a snapshot. **Re-read it (`todo_list`)** to stay in sync, don't trust your memory of it.
- It is **the user's status window** — how they follow what's happening at a glance, without reading
  the chat. Short, concrete step titles; statuses always current.

## Granularity

| Size of the ask | Shape in the plan |
| --- | --- |
| 1–2 execution steps, including a one-shot answer, check, or edit | no list unless the user asks for one |
| 3–7 substantive steps | one group |
| more than ~10 steps | those are tasks, not steps — split into several groups |

Steps are **verifiable** and ≈ commit-sized: "easy to check off as you go", not "phase 1".

## Working with it

1. **Publish a useful plan, not a speculative one.** Once the task is understood enough to identify
   at least three substantive execution steps, or to satisfy the user's explicit request for a plan,
   use `todo_write` with one group per task. Clarifying questions may come first when their answers
   change the plan. Publish the plan before execution, then refine it only when the work materially
   changes.
2. **Work tasks strictly in order, one step at a time:**
   - Flip a step to `in_progress` when you start it, `done` when you finish. Starting a new step
     auto-returns any other `in_progress` step to `pending` — so finish (mark `done`) before moving on,
     or the previous step visibly falls back to open.
   - Don't start the next group while the current one has open steps. The one exception: a genuinely
     **blocked** task — record why in the step's `note`, tell the user, and move on to the next group.
   - Re-read with `todo_list` before choosing each next item, after user input, and before completion.
     New user items are appended to the lane at the end — take them up after the in-progress step. If
     an item you planned is gone, the user dropped it: skip it and do not re-add it.
   - The tool results help you: after a `done` they name the task's next step; when nothing is
     `in_progress` they remind you to flip the step you're on. Act on those nudges.
3. **A qualifying new ask mid-session gets a new group** (`todo_add` with `group:`, one per step, or
   several calls for several steps). An ordinary 1–2-step chat ask gets that group only when the user
   explicitly requested a plan; otherwise finish the in-progress task, then handle it directly. When
   that short ask is already a pending user-origin loose item, instead progress that exact item with
   `todo_update` until done. Never mix a new ask's steps into the current group. **A step discovered
   inside the current task** slots in with `todo_add after: <current step id>`; an anchor in the user's
   loose lane is rejected. Do not rebuild the plan with `todo_write` for that.
4. **Reconcile before completion.** Read `todo_list` once more before the final handoff. If open
   steps remain, either do them or clearly say what is left and why.

## Completion summaries (the review trail)

The user reviews your work from the summary + the diff. The diff shows *what*; the summary must carry
everything the diff cannot show — intent, decisions, and honesty about verification. Write it for the
reviewer, not for yourself.

- **A step that changed code gets a summary AND a verification when you mark it done** — pass both
   on the same `todo_update` call that sets `status: done`. `summary`: 1–3 short sentences covering
   **what changed** and **why** — especially decisions that are NOT visible in the diff (a rejected
   alternative, a constraint you worked around). Research/analysis/verification-only steps that
   produced no code changes need neither.
- **Verification is its own field, named, never claimed.** Pass `verification` with the exact check
   you ran and its result ("`bun test src/todos` — 34 pass", "typecheck green") — or the honest
   **"not verified"**; the UI renders it as a status badge on the review card, so a vague or missing
   line is visible at a glance. Never write "tests pass" for tests you didn't run. And never make a
   check pass by weakening it — if you changed, skipped, or deleted a test as part of the step, the
   summary must say so explicitly: a reviewer who finds it themselves stops trusting every other
   summary.
- **A step that changed code also gets a `commitSubject`.** The host commits that step's delta on the
   user's branch and uses this line as the commit subject verbatim, so write it as a **commit message,
   not a plan step**: one imperative line about the *change*, and in **this repository's existing
   style** — run `git log --oneline -20` and match what you see (Conventional Commits ⇒
   `type(scope): subject`; a prose-subject repo ⇒ prose). It must be pushable as-is: no `todo:`
   prefix, no item ids, no tool attribution. Omit it and the host falls back to the step title, which
   reads as a plan step in `git log` — so don't rely on that.
- **Disclose scope drift.** Anything you touched beyond the step's own ask — an adjacent refactor, a
   drive-by rename, a new dependency — goes in the summary ("also touched X because Y"). The
   signature failure of agent changes is solving the asked problem *plus* neighbors; undisclosed
   extras are what reviewers distrust most.
- **Point at the risk.** When one part of the change deserves the reviewer's closest look — a
   contract/API change, tricky concurrency, an area you're least sure of — name it in one clause
   ("closest look: the rollback path").
- **When the last open item flips done, write the overall plan summary** with `todo_plan_summary`
   (the `todo_update` result nudges you at exactly that moment): 2–4 sentences across all tasks — a
   handoff note, not a step list. Include what was verified end-to-end and anything left undone or
   deferred — an omission here reads as "nothing left", so say it if something is.
- **Fix requests re-open the SAME item.** When the user asks for a fix on a reviewed step (you'll
   receive the original step, its summary, its change set, and their feedback), flip **that exact item**
   (by id) back to `in_progress`, make the fix, and mark it `done` with a **fresh summary** and a
   **fresh `commitSubject`** describing the fix — the fix, not the original work (the user re-reviews
   only the new delta, and the revision lands as its own commit). Re-opening clears the previous
   values, so supply both again. Never open a new item for a fix — the revision must attach to the step
   it revises.

## Invariants

- **Done stays.** Completing a step = `todo_update` → `done`. **Never delete a done item** — it's the
  user's history. `todo_remove` is only for when the user explicitly asks to drop something.
- **Edit surgically.** After the first plan, prefer `todo_update` / `todo_add` (they touch one item) for
  a single change — cheaper than restating the whole plan. `todo_write` **reconciles** (it's not a
  destructive replace): it matches your written steps to the existing ones by group + step title and
  keeps their status/summary/id, so a re-plan is safe and lossless — reach for it when you're genuinely
  restructuring, not to nudge one item. Status advances only via `todo_update`; a `status` you put in
  `todo_write` on a step that already exists is ignored.
- **Respect the user's edits.** The list is shared; treat their additions as new requests and their
  removals as cancellations. Loose items are theirs — do them, but don't rewrite or drop them when you
  re-plan. (`todo_write` never touches user items and keeps done items; but keep your steps' titles
  stable across a re-plan — a reworded title reads as a new step, so the old one's progress won't carry.)

## Tools

- `todo_list` — read the current plan (the source of truth; re-read to catch the user's edits).
- `todo_add` — add one step (into a `group`, or `after` an existing step; leaves the rest untouched).
- `todo_update` — progress one step (`in_progress` on start, `done` when finished — with a `summary`
  when the step changed code; done stays).
- `todo_remove` — delete one item (only when the user asks).
- `todo_write` — lay out or reconcile the plan (groups only — one per task; matches steps by title and
  keeps their progress; prefer `todo_add`/`todo_update` for a single change).
- `todo_plan_summary` — after the last item is done: a short overall summary of what the plan
  accomplished.
