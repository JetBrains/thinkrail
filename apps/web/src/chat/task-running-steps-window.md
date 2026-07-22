---
id: task-running-steps-window
type: task-spec
status: done
title: "Running agent message: window the live activity steps (keep the current one in view)"
parent: submodule-web-chat
---

# Running agent message: window the live activity steps

## Request

While the agent runs, completed steps fill the screen and the current action is only a tiny loader at
the bottom. Change the **running state of the agent message only**: keep the most recent 3–4 steps
visible, collapse older ones into a single "N completed steps" row (expandable, stays expanded until
the user collapses), and keep the **current in-progress step emphasized and in view** (not pushed down
as steps accumulate) using **existing** emphasis affordances. When the agent finishes, this reverts to
the normal finished appearance. Frontend-only, minimal, own commit, tokens/text-styles untouched.

## Audit

- Routine steps already fold into **`ActivityGroup`** (`chat/ActivityGroup.tsx`). Today the **live**
  (trailing, streaming) group renders as a single collapsed **ticker** line (current step only);
  expanding shows all steps. Primary tool calls render as their own `ToolCard` rows (prominent by
  design — not "steps"). The transcript is a `Virtuoso` list with `followOutput` bottom-pinning + a
  `StreamIndicator` footer loader (the "tiny loader").
- This maps the request's "[collapsed older] → [last 3–4] → [current]" **exactly** onto the live
  ActivityGroup — a contained, single-component change that "fits the current rendering."
- e2e coupling: `fixtures/app.ts` (`expandActivity`) + `@agent` specs target
  `[data-testid="activity-group"][data-expanded="false"]` / `activity-group-toggle` / `activity-step`
  on **finished** groups. Keeping the finished path unchanged preserves them.

## Design (chat/ActivityGroup.tsx only)

- Pure helper **`windowActivity(steps, window)` → `{ olderCount, visible }`** (`visible` = last
  `window` steps; the current step is always `visible.at(-1)`). `WINDOW = 4`.
- **Live, multi-step:** render `[older summary row] → [last WINDOW step rows]`. The older row
  (`activity-group-toggle`) reads **"N completed steps"** and expands to reveal **all** steps (fold
  state persists via `useFold(id)` — stays expanded across new steps until the user collapses). The
  **current step** = the last visible row, marked `isCurrent`.
- **Current-step emphasis:** reuse the existing active-row affordances only — the running row's
  spinner (already there) plus the established `bg-hover` active tint on the current row (same token
  active workspace/tab rows use). No new tokens/colors/sizes/weights.
- **Not pushed down:** windowing bounds the live group to `WINDOW` rows + one summary, so accumulating
  steps roll into the summary instead of marching the current step down; with `followOutput` it stays
  in view.
- **Finished (`live === false`): unchanged** — the collapsed `summarizeSteps` header + expand-all. The
  old single-step-live and finished behaviors are untouched; the now-unused `liveTicker` is removed.
- **Mock/exercise:** unit-test `windowActivity` with many completed steps + a current one (the "mocked
  data" the request calls for; a full live render needs a streaming agent, out of scope for a unit).

## Scope / constraints

Agent response message only (no user messages/composer/tabs/panels). No wire/contract/streamed-field
changes — pure re-layout of already-streamed step data. Tokens + text styles unchanged.
