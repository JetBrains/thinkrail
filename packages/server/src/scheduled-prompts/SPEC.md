---
id: submodule-server-scheduled-prompts
type: submodule-design
status: active
title: scheduled-prompts — durable local prompt scheduling
parent: module-server
---

## Responsibility

Owns durable one-shot prompt schedules and their delivery to the existing session follow-up path.
The host starts and stops the scheduler; the host protocol exposes CRUD and scheduled-change events.
This module may use persistence paths and the public agent session API, but never owns a model loop.

## Boundary

The index.ts barrel exposes schedule create, list, update, cancel and send-now operations,
due-time validation, and host start/stop hooks. The module reads persistence and agent/workspace APIs
through their public barrels; the host owns scheduler lifecycle and supplies the event publisher. No
browser or alternate agent runtime is owned here.

Times are absolute instants. Due prompts are serialized per session only until Pi accepts the
follow-up handoff; an idle session is accepted at `agent_start`, so a long run never holds the global
timer or another session's deliveries. Due prompts enter Pi's existing follow-up lane in due-time,
then save order, oldest first (old records use creation time and id). Edits assign a new durable save
order. Creation IDs remain reserved after acceptance by a persisted content fingerprint, so request
retries acknowledge the original handoff without creating a duplicate; a conflicting reuse is rejected.
Accepted IDs are hidden from the scheduled list. A delivery whose result is uncertain is retained as
failed for manual resolution and is never retried automatically.

The explicit sendNow operation moves a scheduled item to due immediately and awaits the same
serialized follow-up delivery path, including older due items. It never steers or interrupts.
Delivery checks current status, due time, and list membership immediately before handoff. In-flight
records are deduplicated while per-session handoffs are serialized. The next global timer is armed
without waiting for accepted agent runs to finish.

Schedules require nonblank text or at least one image. The list represents image-only prompts with a
localized attachment label.

Schedules may pin a provider/model reference and thinking level. New UI schedules snapshot the
composer pair; legacy records without a pair retain their old session-default behavior. Validate
the pair against the session runtime when saving and again at delivery. The pair accompanies
queued content and overrides only the requests for that user prompt, never changing the session's
selected model or reasoning level.

An absent store file starts an empty schedule list. The current store keeps active records and compact
accepted-ID fingerprints in one atomic file, and migrates the earlier record-array format on startup.
If the stored JSON cannot be read, parsed, or validated, keep the file intact, disable scheduling
operations, and return a coded error so a later save cannot replace unreadable data silently.
