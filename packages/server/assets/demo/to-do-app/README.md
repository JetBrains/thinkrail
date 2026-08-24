# To Do App

A tiny, dependency-free to-do list you open straight in the browser — the bundled ThinkRail demo
project. It is a real git repository once opened, so you can cut isolated workspaces from it and pair
with the agent on real changes.

## Run it

Open `index.html` in a browser. Tasks persist in `localStorage`.

## Layout

- `index.html` — the page shell.
- `styles.css` — presentation only.
- `src/storage.js` — load/save the task list (localStorage).
- `src/app.js` — rendering + add/toggle/delete wiring.

## Try an onboarding task

Cut a workspace and ask the agent to:

- **Add search functionality** — filter the visible tasks by a text query.
- **Add a filter for completed tasks** — show all / active / completed.
