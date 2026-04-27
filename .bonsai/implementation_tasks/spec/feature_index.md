---
id: task-index
type: task-spec
status: done
title: 'Implement index.py: SQLite index management'
depends-on:
- task-frontmatter
implements:
- module-spec
covers:
- backend/app/spec/index.py
tags:
- critical
- new-feature
- frontmatter-sqlite
---
# Implement index.py: SQLite index management

New file replacing `registry.py`. Manages the `.bonsai/index.db` SQLite database — the generated cache rebuilt from frontmatter. Provides schema creation, full rebuild from disk, incremental upsert, and query methods.

**Design reference:** [Frontmatter + SQLite Index Design — §SQLite Index Schema](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#sqlite-index-schema), [§File Discovery & Classification](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#file-discovery--classification), [§Read Flow](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#read-flow), [§Rebuild & Recovery](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#rebuild--recovery)

## Context

Currently `registry.py` provides synchronous read/write of a single `registry.json` file. The new `index.py` replaces it with async SQLite operations via `aiosqlite` (already used in `server_store.py`). The index is always `.gitignored` and can be deleted and rebuilt from frontmatter at any time.

## Plan

1. **Define schema constants** — SQL statements for creating `_meta`, `specs`, `links`, `documents` tables and indexes, matching the design doc exactly. Include `SCHEMA_VERSION = "1"` constant.

2. **Implement `SpecIndex` class**
   ```python
   class SpecIndex:
       def __init__(self, db_path: Path): ...
       async def open(self) -> None: ...
       async def close(self) -> None: ...
   ```
   - `open()`: create/open SQLite db, set PRAGMAs (WAL, NORMAL sync, FK on, etc.), create tables if not exist, check schema version
   - `close()`: close connection cleanly
   - Support async context manager (`__aenter__` / `__aexit__`)

3. **Implement schema management**
   - `_ensure_schema()` — create tables if missing, insert schema version into `_meta`
   - `_check_schema_version()` — read `_meta.schema_version`, trigger rebuild if mismatch
   - `_run_integrity_check()` — `PRAGMA integrity_check`, return bool

4. **Implement upsert methods**
   - `upsert_spec(entry: SpecEntry) → None` — INSERT OR REPLACE into `specs`, delete+reinsert `links`
   - `upsert_document(path: str, title: str, content_hash: str) → None` — INSERT OR REPLACE into `documents`
   - `remove_spec(id: str) → None` — DELETE from `specs` (CASCADE deletes links)
   - `remove_by_path(path: str) → None` — DELETE from `specs` or `documents` by path

5. **Implement query methods**
   - `list_specs(type=None, status=None, tag=None, covers=None) → list[SpecEntry]` — filtered SELECT with `json_each()` for tags/covers
   - `get_spec(id: str) → SpecEntry | None` — single row lookup
   - `get_spec_by_path(path: str) → SpecEntry | None` — lookup by file path
   - `get_links(ids: list[str], direction=None, link_type=None) → list[Link]` — filtered link query
   - `get_all_specs() → list[SpecEntry]` — for graph building
   - `get_all_links() → list[Link]` — for graph building
   - `get_referencing_specs(target_id: str) → list[SpecEntry]` — specs whose links reference `target_id` (for delete cleanup)

6. **Implement full rebuild**
   - `rebuild(project_root: Path, bonsaihide_patterns: list[str]) → RebuildStats` — scan all `.md` files, parse frontmatter via `frontmatter.py`, classify (managed spec vs unmanaged document vs warning), upsert all, return stats `{specs: int, documents: int, links: int, warnings: list[str]}`
   - Use `content_hash` (SHA-256) for each file
   - Log summary on completion

7. **Implement startup check**
   - `ensure_ready(project_root: Path) → None` — open db, check integrity, check schema version, rebuild if needed

8. **Add `SpecEntry` model to `models.py`** — matches the `specs` table:
   ```python
   class SpecEntry(BaseModel):
       id: str
       type: str
       path: str
       title: str
       status: str = "draft"
       covers: list[str] = []
       tags: list[str] = []
       extras: dict[str, Any] = {}
       content_hash: str = ""
       indexed_at: str = ""
   ```

9. **Unit tests** — Cover:
   - Schema creation on fresh db
   - Upsert spec + links, verify round-trip
   - Query with each filter (type, status, tag, covers)
   - Full rebuild from test fixture directory
   - Incremental update (content_hash unchanged → skip)
   - Remove spec → CASCADE deletes links
   - Schema version mismatch → triggers rebuild
   - Integrity check failure → triggers rebuild
   - Dangling links (to_id not in specs) → allowed, no error

## Files to modify

- `backend/app/spec/index.py` — **NEW** — `SpecIndex` class with all methods above
- `backend/app/spec/models.py` — Add `SpecEntry` model
- `backend/tests/spec/test_index.py` — **NEW** — unit tests
- `.gitignore` — Add `.bonsai/index.db` (if not already present)

## Definition of done

- `SpecIndex` class fully implemented with async SQLite via `aiosqlite`
- All query methods return proper Pydantic models
- Full rebuild + incremental upsert work correctly
- Content hash change detection skips unchanged files
- Schema version tracking with auto-rebuild on mismatch
- Unit tests pass for all cases listed above
- `.bonsai/index.db` is in `.gitignore`

## Style Notes

Follow conventions in `.claude/CLAUDE.md § Code Style — Python Backend`:
- Fully async class using `aiosqlite` (consistent with `server_store.py`)
- `SpecEntry` as Pydantic `BaseModel` (crosses storage/API boundary)
- `RebuildStats` as `@dataclass` (internal-only container)
- Section separators: `# ── Schema ──────`, `# ── Queries ──────`, `# ── Rebuild ──────`
- Class-based tests: `class TestSpecIndex:`, `class TestRebuild:`, etc.
- Graceful fallback: integrity check failure → rebuild, not crash

**Priority:** Critical — blocks service.py updates and MCP tools rewrite
**Depends on:** task-frontmatter (uses `parse_frontmatter`, `extract_links`)
**Started:** 2026-04-16
