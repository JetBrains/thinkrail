---
id: submodule-server-history
type: submodule-design
status: active
title: history — chat-history search index
parent: module-server
depends-on: [module-contracts]
tags: [v1, history]
---

## Responsibility
The `history.search` backend: a **lazy in-memory index** over pi's session JSONL files (prompt recall +
full-conversation matches). Reads via pi's `SessionManager.listAll()`; **never writes** session files.

## Design
- `extract.ts` — pure JSONL→`HistoryEntry[]`; `messageIndex` counts user/assistant/toolResult/custom in
  file order (the `getSessionMessages` filter), so it anchors into the transcript the client renders.
  Searchable text capped (`MAX_SEARCHABLE`); tool results/thinking not indexed (V1).

## On-disk JSONL structure (observed from pi session files)
- **`message` entries:** `{ type: "message", ..., message: { role: "user"|"assistant"|"toolResult", content: string|array, timestamp: ms-number } }`
  — `message.role` determines renderability; `message.timestamp` is milliseconds since epoch.
- **`custom_message` entries:** `{ type: "custom_message", customType: string, content: string|array, timestamp: ISO-string, display: boolean, ... }`
  — top-level structure (no `message` wrapper); always renderable as role "custom"; `timestamp` is ISO 8601 string at entry level.
- `historyIndex.ts` — `HistoryIndex`: cold build on first search (batched, yields the event loop);
  freshness = mtime revalidation throttled to ~2 s (pi appends live messages to the file, so the file IS
  the live feed — no agent-module hook). Matching: case-insensitive substring AND over whitespace terms;
  strict recency order; prompts deduped by normalized text keeping newest; caps + true totals.
- Jump anchors are drift-tolerant: hits carry `anchorText` (message-text prefix) the client validates.

## Boundary
- **Public surface (`index.ts`):** `HistoryIndex`, `getHistoryIndex()`, `extractEntries`, types.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (`SessionManager`), `@thinkrail/contracts`, `node:fs`.
- **Forbidden:** importing `agent`/`workspaces`/`projects` (scope mapping is injected by the host handler);
  writing anything to disk.
