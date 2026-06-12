---
id: index-concurrency
type: submodule-design
status: active
title: SQLite Index & Concurrency Model
parent: frontmatter-registry
depends-on:
  - frontmatter-schema
covers:
  - backend/app/spec/index.py
  - backend/app/spec/coordinator.py
tags:
  - backend
  - concurrency
  - sqlite
  - index
---
# SQLite Index & Concurrency Model

> Status: **Active** | Created: 2026-04-27 | Parent: [FRONTMATTER_REGISTRY_DESIGN.md](../../../.tr/design_docs/FRONTMATTER_REGISTRY_DESIGN.md)

Defines the SQLite index schema, rebuild/recovery strategy, and the IndexCoordinator concurrency model that serializes all index mutations.

---

## SQLite Index Schema

**File:** `~/.tr/indexes/<project-hash>/index.db` (outside the project repo, in the server data directory)

**Library:** `aiosqlite` (consistent with existing `app_store.py`)

**PRAGMAs** (same as app store):
```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA auto_vacuum = FULL;
PRAGMA cache_size = -64000;
PRAGMA temp_store = MEMORY;
```

### Tables

```sql
CREATE TABLE _meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE specs (
    id           TEXT PRIMARY KEY,
    type         TEXT NOT NULL,
    path         TEXT NOT NULL UNIQUE,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'draft',
    covers       TEXT NOT NULL DEFAULT '[]',   -- JSON array
    tags         TEXT NOT NULL DEFAULT '[]',   -- JSON array
    extras       TEXT NOT NULL DEFAULT '{}',   -- JSON object (custom fields)
    content_hash TEXT NOT NULL,                -- SHA-256 of file content (change detection)
    indexed_at   TEXT NOT NULL                 -- ISO 8601 timestamp
);

CREATE TABLE links (
    from_id TEXT NOT NULL REFERENCES specs(id) ON DELETE CASCADE,
    to_id   TEXT NOT NULL,  -- may reference a spec not yet indexed (dangling OK)
    type    TEXT NOT NULL,  -- parent, depends-on, references, implements
    UNIQUE(from_id, to_id, type)
);

CREATE TABLE documents (
    path         TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    indexed_at   TEXT NOT NULL
);
```

### Design Notes

- **`links.to_id` is not a foreign key** — allows dangling references. Validation can warn but won't block.
- **`content_hash`** enables incremental re-indexing: skip files whose hash hasn't changed.
- **`extras`** stores arbitrary custom frontmatter fields as a JSON object, preserving extensibility.
- **`ON DELETE CASCADE`** on `links.from_id` ensures deleting a spec auto-cleans its outgoing links.

---

## Rebuild & Recovery

### Full Rebuild

Triggered when:
- `index.db` is missing (first clone, manual deletion)
- `index.db` is corrupt (failed PRAGMA integrity check)
- User/agent explicitly requests rebuild
- Schema version mismatch (after upgrade)
- `.thinkrailhide` file changes (debounced — see [Concurrency Model](#concurrency-model))

Process (executed by the IndexCoordinator's single consumer):
1. Drain any pending `FileChanged` events from the queue (stale — rebuild re-scans everything)
2. Emit `index/rebuilding` notification to frontend
3. Begin an explicit SQLite transaction (`BEGIN IMMEDIATE`)
4. Delete all rows from `specs`, `links`, and `documents` tables
5. Discover all `.md` files via async tree walk (respecting `.thinkrailhide`)
6. Read and parse each file asynchronously (`aiofiles`), classify, and insert
7. Stamp schema version in `_meta`
8. Commit the transaction — readers atomically see all new data
9. Set `_ready_event`, emit `index/ready` notification

During steps 3–7, readers see the pre-rebuild data (WAL snapshot). After the commit in step 8, readers atomically see the new complete data. No partial or empty states are ever visible.

### Incremental Update

On each file change detected by the watcher:
1. Watcher emits `FileChanged(path)` event to the IndexCoordinator
2. Coordinator's single consumer processes the event:
   a. Read file content asynchronously (`aiofiles`)
   b. Compute `content_hash`, compare with stored hash
   c. If unchanged, skip (no-op)
   d. If changed, re-parse frontmatter and upsert
3. Coordinator emits appropriate notification (`spec/didChange` for specs, `docs/didChange` for unmanaged documents)

### Startup Check

On WebSocket connect (per-project, guarded by `threading.Lock` for dict access):
1. Accept WebSocket connection immediately
2. **Phase 1 — `ProjectContext.start()`:** Open `index.db`, set PRAGMAs via `SpecIndex.open()`. Probe `_meta.schema_version` (catch `OperationalError` on fresh DB). Store whether rebuild is needed.
3. Subscribe connection to the project topic (so notifications reach the frontend)
4. **Phase 2 — `ProjectContext.start_services()`:** Start the IndexCoordinator's consumer task. If rebuild needed → emit `RebuildRequested` to coordinator. If version matches + integrity OK → set `_ready_event` immediately, emit `DiffScanRequested` for background catchup. Start the file watcher.

### Differential Scan

Triggered on cold start when the index already exists and the schema version matches. Runs as a background task through the coordinator's event queue.

Process:
1. Walk all `.md` files under project root (async, respecting `.thinkrailhide`)
2. For each file, call `reindex_file()` which compares `content_hash` with stored value
3. Files with matching hashes are skipped (no-op)
4. Files with changed content are re-parsed and upserted, with individual notifications emitted
5. After scanning all current files, query the index for all known paths (specs + documents). Remove any entry whose path was not seen during the walk — these are files deleted while the server was down. Emit `docs/didChange` and/or `spec/didChange` notifications for each removal.

The index serves existing data immediately while the scan runs — the differential scan is non-blocking. Step 5 ensures that offline deletions are detected: without it, stale entries for deleted files persist indefinitely until the next full rebuild.

---

## Concurrency Model

All index mutations are serialized through an **IndexCoordinator** — a single-consumer event bus backed by an `asyncio.Queue`. This eliminates concurrent write races by design: only one coroutine (the coordinator's consumer task) ever mutates the SQLite index.

### Event Types

| Event | Fields | Emitted By | Effect |
|-------|--------|-----------|--------|
| `FileChanged` | `path`, `deleted` | File watcher | Coordinator calls `reindex_file()` |
| `RebuildRequested` | `thinkrailhide_spec`, `reason` | Init, `.thinkrailhide` watcher | Full transactional rebuild |
| `DiffScanRequested` | *(none)* | Init (cold start) | Background incremental scan of all files |
| `SpecDeleteRequested` | `spec_id` | Agent `spec_delete` tool | File removal + cross-file cleanup + index update |

### Key Invariants

1. **Single writer** — only the coordinator's consumer task calls mutating methods on `SpecIndex`. Agent tools and the watcher are pure event producers.
2. **Reads are always safe** — WAL mode ensures readers see a consistent snapshot. During a transactional rebuild, readers see the pre-rebuild data until the single `COMMIT`, then atomically see the new data.
3. **Rebuild is atomic** — the entire rebuild (delete all + re-insert all) is a single SQLite transaction. No partial or empty states are ever visible to readers.
4. **Events are FIFO** — the coordinator processes events in emission order, ensuring causal consistency.

### Debounce

Rapid `.thinkrailhide` edits are coalesced: the coordinator's `request_rebuild()` method manages a 500ms quiescence timer. Only after 500ms with no further changes does a `RebuildRequested` event enter the queue — carrying the latest `.thinkrailhide` patterns.

### Readiness Signaling

The `_ready` boolean on `SpecIndex` is replaced with an `asyncio.Event`:
- `is_ready` property → `event.is_set()` (non-blocking, backward compatible)
- `wait_ready(timeout)` method → awaitable (for callers that need to block)
- `rebuild()` calls `event.clear()` at start, `event.set()` in `finally`
- On cold start with version match, the event is set immediately (before the differential scan runs)

### Async File I/O

File discovery (`_find_md_files()`) runs via `asyncio.to_thread()` to avoid blocking the event loop during tree walks. Per-file reads use `aiofiles` for non-blocking I/O. This applies in both `_do_rebuild()` and `reindex_file()`.

### Coordinator Lifecycle

The coordinator is owned by a `ProjectContext` instance — a per-project service container that manages all project-scoped state (index, coordinator, watcher, and application services). One `ProjectContext` per project, cached in a single `_projects` dict.

**Creation:** `ProjectContext.__init__()` creates both `SpecIndex` and `IndexCoordinator` (lightweight, no I/O).

**Start (two-phase):** `ProjectContext.start()` is called by the first connection after context creation. It opens the index and checks the schema version (<10ms). Then `ProjectContext.start_services()` is called after the connection subscribes to the project topic — it starts the coordinator's consumer task, emits the initial `RebuildRequested` or `DiffScanRequested` event, starts the file watcher, and starts the model registry refresh. This two-phase split ensures coordinator notifications (e.g. `index/rebuilding`, `index/ready`) reach the frontend. No background init task — the heavy work (rebuild, diff scan) runs asynchronously via coordinator events.

**Shutdown:** `ProjectContext.shutdown()` runs when the last connection disconnects. Stops the watcher, stops the coordinator (cancels consumer task), and closes the index — reverse order of `start()`.

**Service injection:** `spec_service` is wired automatically when first accessed via `ProjectContext`'s lazy properties. The coordinator's `_handle_spec_delete` gets access to the full delete flow (file move to trash, dangling ref cleanup, index removal) through this injection. Without it, delete falls back to index-only removal.

---

## Watcher Validation Hook

When the file watcher detects a `.md` file change, the frontmatter parser validates the content and provides feedback:

### Validation Rules

| Rule | Severity | Action |
|------|----------|--------|
| Missing `id` field | Error | Log warning, index as unmanaged document instead |
| Missing `type` field | Error | Log warning, index as unmanaged document instead |
| Duplicate `id` (conflicts with existing spec) | Error | Notify frontend with error, do not index |
| Unknown `type` value | Warning | Index anyway, flag in frontend |
| Dangling link target (referenced spec doesn't exist) | Warning | Index anyway, warn in frontend health view |
| Malformed YAML frontmatter | Error | Log error, index as unmanaged document |

### Notification Flow

When validation finds issues, the watcher sends a notification to the frontend:

```json
{
  "method": "spec/validationError",
  "params": {
    "path": "backend/app/spec/README.md",
    "errors": [
      {"field": "id", "message": "Missing required field 'id'", "severity": "error"}
    ],
    "warnings": [
      {"field": "depends-on", "message": "Referenced spec 'future-module' not found", "severity": "warning"}
    ]
  }
}
```

This provides immediate feedback when agents write invalid frontmatter — the "belt and suspenders" approach: skills teach the format, hooks catch mistakes.
