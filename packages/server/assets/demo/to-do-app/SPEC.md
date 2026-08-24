---
id: to-do-app
type: goal-and-requirements
status: active
title: To Do App
tags: [demo]
---

## Goal

A tiny, dependency-free to-do list that runs straight in the browser — the bundled ThinkRail demo
project. It exists so a new user can try the ThinkRail loop (create a workspace, pair with the agent,
review changes) on a real git repository without bringing one of their own.

## Scope

- Add a task from a text input.
- Toggle a task complete / active.
- Delete a task.
- Persist the list across reloads (browser `localStorage`).

## Structure

- `index.html` — the page shell and the new-task form.
- `styles.css` — presentation only (system color tokens, no framework).
- `src/storage.js` — load/save the task list.
- `src/app.js` — rendering plus add / toggle / delete wiring.

## Suggested next steps

Good first tasks to pair with the agent on:

- **Add search** — filter the visible tasks by a text query.
- **Filter by status** — show all / active / completed tasks.
