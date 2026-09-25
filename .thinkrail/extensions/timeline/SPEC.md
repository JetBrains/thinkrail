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
  settlement stop reason is `error`/`aborted`. `message_end`/`turn_end` outside a live run, and
  `compaction_end` for an already closed span, change nothing, so a run that was already going at load
  (extension reload, trust granted mid-run) cannot overwrite saved turns; its first spans are lost.
- `turn_start`/`turn_end` make a turn span (`r<run>t<turn>`); `message_end` of an assistant message puts
  pi's own usage and cost on it. Tool spans are children of the current turn; `partialResult` replaces
  the preview, the final `result` replaces it again. Compaction start/end make a compaction span (the
  session-compact marker).
- At most 400 spans per session: the oldest closed span (a closed turn with its children) goes first,
  and `dropped` counts them. Previews are clipped to 600 characters.

## Host half (`index.ts`)

- Publishes `<sessionId>` (the `Timeline` without span previews) at most every 150 ms while events
  arrive, and at once at `agent_settled`. Each flush still resends every span of the session (≤ 400). Publishes `cost:<sessionId>` (pi's `SessionStats`) after every `turn_end` and at
  `agent_settled`; cost is never computed here.
- Settled timelines persist in `tr.store` for the 12 most recent sessions, so an extension reload or host
  restart keeps history. Every 30 s, every published session that is no longer open (except the last
  watched one) is dropped from memory and unpublished; evicted archive entries are unpublished at once.
- Actions: `watch` (views call it when the active chat changes; republishes that session's timeline,
  and cost when the session is open), `preview` (`{ spanId }` → `{ preview }` for the detail view),
  `clear` (drops the session's settled spans).

## Views

- `timeline` (panel): one section per run, newest first. Lanes mode: one lane per turn, bars placed on
  the run's time axis and packed into rows, live bars grow on a 250 ms tick. Flame mode: turns sized by
  cost (by duration when the run has no cost), tools under each turn sized by duration. Clicking a span
  shows its detail and preview.
- `cost` (status): `$0.42 · 38% ctx · 3 running` for the active chat; click opens the panel.

## Boundary

- Public surface: the `timeline` and `cost` surfaces, actions `watch`/`preview`/`clear`, and the
  `<sessionId>` and `cost:<sessionId>` channels.
- Host half: `index.ts`. Views: the `.tsx` files plus `hooks.ts` and `layout.ts`. `model.ts` is shared
  (pure reducer, type-only SDK import).
- Allowed dependencies: `@thinkrail/ext`, `@thinkrail/ext/view`, `react`.
- Forbidden: any ThinkRail package internals (`packages/*/src`, `apps/*`), views importing `index.ts`,
  and the host half importing views.

## Not covered

- Delegated child sessions (`tr.on` sees top-level sessions only) and per-provider-request spans.
- A run still going when the host restarts or the extension reloads is lost; only settled runs persist.
