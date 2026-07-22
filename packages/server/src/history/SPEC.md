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
Because `listAll()` walks every pi session on disk, the host handler's `all` scope (`host/historyScope.ts`'s
`filter = () => true`) deliberately surfaces pi-CLI sessions outside any registered ThinkRail workspace
too — a bit more than `session.getMessages` itself ever exposes for a single session, but consistent with
an owner-scoped host (no multi-tenant isolation to preserve).

## Design
- `extract.ts` — pure JSONL→`HistoryEntry[]`; `messageIndex` counts user/assistant/toolResult/custom in
  file order (the `getSessionMessages` filter), so it anchors into the transcript the client renders.
  Searchable text capped (`MAX_SEARCHABLE`); tool results/thinking not indexed (V1).
- `historyIndex.ts` — `HistoryIndex`: cold build on first search (batched, yields the event loop);
  freshness = mtime revalidation throttled to ~2 s (pi appends live messages to the file, so the file IS
  the live feed — no agent-module hook). Matching: case-insensitive substring AND over whitespace terms;
  strict recency order; prompts deduped by normalized text keeping newest; caps + true totals. **v11:**
  the messages section (and `messageTotal`) is filtered to `role === "assistant"` only — a user-role hit
  is always a textual duplicate of its own prompt entry (user text IS a prompt in this extraction), so it
  would add no text, only a location; that location moves onto the prompt hit instead, via the two
  fields below.
- Jump anchors are drift-tolerant: hits carry `anchorText` (message-text prefix) the client validates.
  **v11:** every prompt hit now also carries its kept-newest occurrence's `messageIndex`/`anchorText` —
  the same two fields `MessageHit` always had — making the prompt row itself jumpable. Both fields are
  optional on `PromptHit` (absent only when the server predates v11).
- `testFixtures.ts` — test-only session-file builders (pinned by A5): `writeFixtureSession` writes a
  minimal but real pi-shaped JSONL, one flat file per session, that `historyIndex` tests, the e2e fixture
  seeder, and its own format-pinning test (`testFixtures.test.ts`) drive against; `defaultSessionDirFor`
  replicates pi's private default-layout directory encoding (not importable — see "pi file format" below)
  so fixtures can land where a real no-arg `listAll()` would actually look.

## On-disk JSONL structure (observed from pi session files)
- **`message` entries:** `{ type: "message", ..., message: { role: "user"|"assistant"|"toolResult", content: string|array, timestamp: ms-number } }`
  — `message.role` determines renderability; `message.timestamp` is milliseconds since epoch.
- **`custom_message` entries:** `{ type: "custom_message", customType: string, content: string|array, timestamp: ISO-string, display: boolean, ... }`
  — top-level structure (no `message` wrapper); always renderable as role "custom"; `timestamp` is ISO 8601 string at entry level.

## pi file format (pinned v0.80.6 — `@earendil-works/pi-coding-agent`)
Verified by reading `dist/core/session-manager.{js,d.ts}` in the installed package (source of truth over
any assumption — re-verify on a pi version bump):
- **Header line** (always line 1, `SessionHeader`): `{ type: "session", version?: number, id: string,
  timestamp: string /* ISO */, cwd: string, parentSession?: string }`. `readSessionHeader`/`buildSessionInfo`
  reject the file (return `null`/`[]`) unless the first line parses as JSON with `type === "session"` and a
  string `id`. `CURRENT_SESSION_VERSION = 3`; pi's own writer stamps `version: 3` — fixtures should too, so
  a real `SessionManager` that later opens one never runs migration.
- **File naming:** discovery is driven **purely by the `.jsonl` suffix** — `listSessionsFromDir` does
  `readdir(dir).filter(f => f.endsWith(".jsonl"))`; nothing parses the filename. pi's own writer names new
  files `<isoTimestamp-with-:-and-.-replaced-by-'-'>_<sessionId>.jsonl`, but any `*.jsonl` name works for
  discovery — fixtures don't need to match that exact pattern.
- **`cwd` recovery — and the non-recursive-custom-dir trap:** `cwd` always comes from the header's `cwd`
  field (`header.cwd`), never from directory placement. But *directory structure interacts with discovery*:
  `SessionManager.listAll()` (no args) walks pi's real default root (`~/.pi/agent/sessions/`) **one level of
  subdirectories** — one dir per encoded cwd (`getDefaultSessionDirPath`: `--<cwd, / and \ and : → '-'>--`)
  — and flattens the `.jsonl` files found inside each. But `listAll(sessionDir)` / `list(cwd, sessionDir)`
  — the path taken whenever a **custom** `sessionDir` string is passed (exactly what `HistoryIndex`'s
  constructor and this module's tests do) — calls `listSessionsFromDir(customDir)`, which does a **flat,
  non-recursive** `readdir(customDir)`. Files placed in subdirectories of a custom `sessionDir` are invisible
  to `listAll`. Consequence for fixtures: multi-session, multi-cwd test fixtures must write all `.jsonl`
  files **flat, directly under** the given dir; different `cwd`s are expressed via each file's own header
  `cwd` field, never via subdirectory nesting.
- **Default-layout encoding is not importable — fixtures replicate it (pinned by A5):** the per-cwd
  subdirectory name above is computed by `getDefaultSessionDirPath`, a *private* (unexported) helper inside
  `core/session-manager.js`. The mkdir-ing wrapper that IS exported from that module (`getDefaultSessionDir`)
  is not re-exported from the package root `@earendil-works/pi-coding-agent` index either (checked
  `dist/index.js`: only `SessionManager` + a handful of pure tree-traversal helpers cross that boundary) —
  so nothing importable computes this path. `testFixtures.ts` exports `defaultSessionDirFor(agentDir, cwd)`,
  a from-scratch replica of the exact regex (`--<cwd, / and \ and : → '-'>--`), pinned in
  `testFixtures.test.ts` against a real `SessionManager.list(cwd)` / `listAll()` call — re-verify against
  `dist/core/session-manager.js` on a pi version bump.
- **`PI_CODING_AGENT_DIR` is read live, not cached (pinned by A5):** `getAgentDir()` (`config.js`) reads
  `process.env.PI_CODING_AGENT_DIR` directly in its function body on every call — there is no top-level
  capture at module load. So a same-process test (or the e2e seeder) can set the env var immediately before
  the `SessionManager` call it needs to affect and restore it in a `finally`/`afterAll`; no subprocess is
  needed to observe a "live" env read. (Existing precedent: `agent/agentSessionManager.test.ts` already
  does this for its disk-reopen case.)

## Boundary
- **Public surface (`index.ts`):** `HistoryIndex`, `getHistoryIndex()`, `matchesTerms`, `makeSnippet`,
  `extractEntries`, `writeFixtureSession`, `defaultSessionDirFor` (test-only; re-exported for A5's e2e
  fixture seeder), types.
- **Allowed deps:** `@earendil-works/pi-coding-agent` (`SessionManager`), `@thinkrail/contracts`, `node:fs`,
  `node:path`.
- **Forbidden:** importing `agent`/`workspaces`/`projects` (scope mapping is injected by the host handler
  via the `filter`/`labels` callbacks passed into `search()`); writing anything to disk (`writeFixtureSession`
  is test-only, never called from production code paths).
