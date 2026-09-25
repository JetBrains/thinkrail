---
id: ext-timeline
type: submodule-design
status: active
title: timeline — run timeline and cost extension
parent: module-ext-sdk
references: [submodule-server-ext, submodule-web-ext]
tags: [extensions, example]
---

## Responsibility

Answers "why did that run cost $1.40 and what was the agent doing for 3 minutes?" for the active chat.
A ThinkRail UI extension written only against `@thinkrail/ext` and `@thinkrail/ext/view`; the SDK
README's second example.

## Span model

`model.ts` is a pure reducer `(Timeline, pi event, now) → Timeline`, shared by the host half and views.
A `Span` is `{ id, sessionId, run, parentId?, kind: turn | tool | compaction, name, label?, start, end?,
status: running | ok | error, tokens?, costUsd?, preview? }`.

- A run opens on the first `agent_start`, `turn_start`, or tool start while no run is live, and closes only
  at `agent_settled` (never `agent_end`); spans still running then close as `ok`, or `error` when the
  settlement stop reason is `error`/`aborted`.
- `turn_start`/`turn_end` make a turn span (`r<run>t<turn>`); `message_end` of an assistant message puts
  pi's own usage and cost on it. Tool spans are children of the current turn; `partialResult` replaces
  the preview, the final `result` replaces it again. Compaction start/end make a compaction span (the
  session-compact marker).
- At most 400 spans per session: the oldest closed span (a closed turn with its children) goes first,
  and `dropped` counts them. Previews are clipped to 600 characters.

## Host half (`index.ts`)

- Publishes `<sessionId>` (the `Timeline`) at most every 150 ms while events arrive, and at once at
  `agent_settled`. Publishes `cost:<sessionId>` (pi's `SessionStats`) after every `turn_end` and at
  `agent_settled`; cost is never computed here.
- Settled timelines persist in `tr.store` for the 12 most recent sessions, so an extension reload or host
  restart keeps history. Every 30 s, sessions no longer live are dropped from memory and unpublished.
- Actions: `watch` (views call it when the active chat changes; republishes that session's timeline
  and cost), `clear` (drops the session's settled spans).

## Views

- `timeline` (panel): one section per run, newest first. Lanes mode: one lane per turn, bars placed on
  the run's time axis and packed into rows, live bars grow on a 250 ms tick. Flame mode: turns sized by
  cost (by duration when the run has no cost), tools under each turn sized by duration. Clicking a span
  shows its detail and preview.
- `cost` (status): `$0.42 · 38% ctx · 3 running` for the active chat; click opens the panel.

## Not covered

Delegated child sessions (`tr.on` sees top-level sessions only) and per-provider-request spans.
