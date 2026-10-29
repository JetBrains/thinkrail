---
id: submodule-server-resource-history
type: submodule-design
status: draft
title: resourceHistory — the durable archive behind a chat's Resources
parent: module-server
depends-on: [module-contracts, submodule-server-persistence]
references: [submodule-server-agent, submodule-web-chat-resources]
tags: [resources, persistence]
---

## Responsibility

Keep every background command and subagent a chat ran — its summary and, for a command, the retained log
tail — so Resources still shows the chat's whole history after a host restart. The live owners
([[module-pi-background-commands]], [[module-pi-delegation]]) stay in-memory and unaware of it; `agent`
feeds it their lifecycle and asks it for what they no longer hold. It records what the owners reported and
never grants control: nothing here is live authority.

## Boundary

- **Owns:** `<dataDir>/resource-history/<workspaceId>/<sessionId>/` — `index.jsonl` plus `logs/<commandId>.json`
  (`{ text, truncated }`) — and a bounded in-memory cache of loaded indexes.
- **Public surface (barrel):** `recordResource`, `finishedResources`, `pageResources`, `tallyResources`,
  `archivedCommandOutput`, `removeWorkspaceResourceHistory`, `resourceHistoryRoot`, and the
  `ResourceHistoryScope` / `ArchivedOutput` types.
- **Allowed deps:** `contracts` (the resource record vocabulary and ordering), `persistence` (`dataDir`),
  `log`; Node `fs`/`path`/`crypto`.
- **Forbidden:** `agent` or any live owner, pi, sessions or transcripts; deciding liveness itself (the caller
  passes the ids its owners still report); stopping or reading live work.

## Format and invariants

- The index is append-only JSON lines `{ kind, summary }`; the last line per `kind:id` wins and an identical
  summary is never appended twice, so a record costs one line per reported status. Lines that do not parse
  or fail the shape guard are skipped — a torn last line from a crash is one such line, and the next append
  starts on a fresh line so it cannot swallow it.
- Writes are synchronous: a graceful shutdown's terminal edges arrive right before the process exits, and an
  awaited write could be lost. A finished command's log is written atomically before its index line, so a crash
  between the two leaves an unclaimed log rather than a claimed missing one. Write failures are logged, never
  thrown into the owners' lifecycle.
- **Interrupted is derived, never stored by a reader:** an archived record still in flight whose id no live
  owner reports was cut off — the host died or the chat was torn down — and reads with `interrupted: true`
  (no finish time, ordered by its start). A crash-interrupted command therefore has no log; one cut off by a
  graceful teardown was already recorded terminal, with its log, by `agent`.
- Storage ids are validated before any path is built; an unsafe workspace, session or command id is
  ignored, never escaped.
- History is unbounded per chat by decision (user-settled, 2026-10): every record and every log tail lives as
  long as the workspace. Chat deletion leaves it in place — a chat restored from the OS trash gets its history
  back, as its subagent transcripts do — and workspace archive removes the workspace's directory.
- Several hosts may share a data dir but not a live chat (as pi's transcripts already assume); concurrent
  writers to one chat are last-writer-wins.

## Verification obligations

Upsert/dedupe, survival across a fresh module instance (the restart), derived interruption against a live
set, log round-trip and its absence for a crash, torn/foreign line tolerance, newest-first paging from a
cursor, outcome tallies, unsafe-id refusal, and workspace removal on disk and in cache.
