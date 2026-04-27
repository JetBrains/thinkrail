---
id: task-service-frontmatter
type: task-spec
status: done
title: 'Update service.py: frontmatter writes + SQLite reads'
depends-on:
- task-frontmatter
- task-index
implements:
- module-spec
covers:
- backend/app/spec/service.py
tags:
- critical
- refactor
- frontmatter-sqlite
---
# Update service.py: frontmatter writes + SQLite reads

Refactor `SpecService` to write YAML frontmatter into spec files and query the SQLite index for reads. The service becomes the bridge between the frontmatter source-of-truth and the index cache. The public API (`list_specs`, `get_spec`, `create_spec`, `update_spec`, `delete_spec`, `get_graph`) remains unchanged — only the internal implementation changes.

**Design reference:** [Frontmatter + SQLite Index Design — §Write Flow](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#write-flow), [§Read Flow](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#read-flow)

## Context

Currently `SpecService` reads/writes `registry.json` for all metadata. After this refactor:
- **Writes** produce spec files with YAML frontmatter (using `frontmatter.py`)
- **Reads** query `index.db` via `SpecIndex` (using `index.py`)
- The file watcher re-indexes changed files, but the service also updates the index directly after its own writes (avoiding watcher latency)
- `registry.py` imports are completely removed

## Plan

1. **Update `__init__`** — Accept a `SpecIndex` instance (injected by `rpc/server.py`) instead of deriving registry path. Keep `config` for project root.
   ```python
   def __init__(self, config: AppConfig, index: SpecIndex) -> None:
   ```

2. **Refactor `create_spec`**
   - Build frontmatter dict: `{id, type, status: "draft", title}`
   - Serialize content with frontmatter via `serialize_frontmatter(meta, body)`
   - Write file atomically to disk (existing `write_text`)
   - Upsert into index directly (don't wait for watcher)
   - Return `SpecDetail` built from index entry + file content

3. **Refactor `update_spec`**
   - Read existing file from disk
   - Parse frontmatter + body via `parse_frontmatter`
   - If content changed: update body, re-serialize with existing frontmatter
   - If metadata changed: merge into frontmatter dict, re-serialize
   - Write file atomically
   - Upsert into index directly

4. **Refactor `list_specs`** — Delegate to `self._index.list_specs()`, map `SpecEntry` → `SpecSummary`

5. **Refactor `get_spec`**
   - Query index for entry by ID
   - Read file content from disk (content always from disk, not index)
   - Query links from index
   - Return `SpecDetail`

6. **Refactor `delete_spec`**
   - Look up spec in index
   - Move file to `.bonsai/trash/` via `trash_service` (existing behavior)
   - **New:** Find all other specs referencing this ID → edit their frontmatter to remove dangling refs (cross-file cleanup)
   - Remove from index
   - Watcher will also pick up the changed files

7. **Refactor `get_graph`** — Query `index.get_all_specs()` + `index.get_all_links()` → build `SpecGraph`

8. **Remove `register_existing`** — No longer needed. Files are auto-discovered by the index rebuild.

9. **Remove all `registry.py` imports** — `read_registry`, `write_registry`, `find_entry`, `add_entry`, `remove_entry` are no longer used.

10. **Update watcher callback** in `rpc/server.py` — On file change:
    - Parse frontmatter from changed file
    - Classify (managed spec vs unmanaged document)
    - Upsert into index
    - Push appropriate notification (`spec/didCreate`, `spec/didUpdate`, `spec/didDelete`)

11. **Unit tests** — Update existing tests in `test_service.py` to use index instead of registry

## Files to modify

- `backend/app/spec/service.py` — Refactor all methods as described above
- `backend/app/rpc/server.py` — Update watcher callback to index files instead of updating registry
- `backend/tests/spec/test_service.py` — Update tests for new index-based implementation

## Definition of done

- `SpecService` no longer imports from `registry.py`
- All reads go through `SpecIndex` (SQLite)
- All writes produce files with YAML frontmatter
- Watcher callback indexes files into SQLite on change
- Delete performs cross-file frontmatter cleanup
- Public API shape (`SpecSummary`, `SpecDetail`, `SpecGraph`) unchanged
- Existing RPC methods work without changes
- Unit tests pass

## Style Notes

Follow conventions in `.claude/CLAUDE.md § Code Style — Python Backend`:
- Keep `SpecService` as the facade pattern from current code
- Preserve the `trash_service` injection pattern
- `SpecNotFoundError` remains the domain exception
- Section separators: `# ── public methods ──────`, `# ── helpers ──────`
- If making service async, ensure all callers (RPC methods) `await` properly

**Priority:** Critical — enables the full frontmatter pipeline
**Depends on:** task-frontmatter, task-index
**Started:** 2026-04-16
