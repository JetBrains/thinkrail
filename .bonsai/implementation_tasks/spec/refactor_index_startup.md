---
id: task-refactor-index-startup
type: task-spec
status: done
parent: module-spec
implements:
  - module-spec
  - module-rpc
references:
  - design-frontmatter-sqlite
depends-on: []
covers:
  - backend/app/spec/index.py
  - backend/app/rpc/server.py
  - backend/app/spec/service.py
  - backend/app/core/bonsaihide.py
  - frontend/src/store/wireEvents.ts
tags:
  - high
  - refactor
  - bug-fix
  - startup
---

# Refactor index startup: single-pass initialize, accept-first WebSocket, bonsaihide unification

Fixes three tightly coupled bugs in the spec index startup path that cause a broken first-connect experience:

1. **Fresh DB stays empty** — `_ensure_schema()` stamps `schema_version` on a new empty DB, so `ensure_ready()` sees a match and skips rebuild. First-time users see an empty spec tree.
2. **WebSocket blocked during rebuild** — `index.open()` + `index.ensure_ready()` run *before* `websocket.accept()`. Rebuild can exceed the frontend's 5s `connectTimeout`, causing a visible connection failure.
3. **`.bonsaihide` patterns never reach the index** — `ensure_ready()` calls `rebuild()` without passing patterns. Hidden files appear in the spec tree even though the file sidebar hides them correctly.

**Design doc:** [`.bonsai/index-startup-refactor/design-doc.md`](../../index-startup-refactor/design-doc.md)
**Implementation plan:** [`.bonsai/index-startup-refactor/implementation-plan.md`](../../index-startup-refactor/implementation-plan.md)

## Plan

### Step 1: Extract `load_bonsaihide` to shared module *(S)*

Create `backend/app/core/bonsaihide.py` with `load_bonsaihide(project_root)` and `_BONSAIHIDE_DEFAULTS`. Move from `backend/app/api/routers/project.py`; update import in `project.py`. No behavior change — existing tests must pass.

### Step 2: Refactor `SpecIndex` — `initialize()`, `is_ready`, pathspec *(L)*

Replace `_ensure_schema()` + `ensure_ready()` with a single-pass `initialize(project_root, bonsaihide_spec)` method:
- Add `self._ready = False` flag and `is_ready` property.
- Add `_DROP_ALL` constant (DROP TABLE IF EXISTS for all 4 tables).
- `initialize()`: open connection → PRAGMAs → probe `_meta.schema_version` (catch `OperationalError` on fresh DB) → if mismatch/fresh/corrupt: `executescript(_DROP_ALL + _SCHEMA)` → `rebuild()` → `self._ready = True`.
- Simplify `open()` to connection-only (PRAGMAs, no schema work). `initialize()` calls `open()` internally.
- Change `rebuild()` and `_find_md_files()` signatures: `bonsaihide_patterns: list[str]` → `bonsaihide_spec: pathspec.PathSpec | None`.
- Replace `str.startswith()` filtering in `_find_md_files()` with `pathspec.PathSpec.match_file()`.
- Remove `_ensure_schema()` and `ensure_ready()`.

### Step 3: Add `is_ready` guards to `SpecService` *(S)*

- Add `IndexNotReadyError` exception.
- Read methods (`list_specs`, `get_graph`) return empty data when `is_ready` is `False`.
- Write methods (`create_spec`, `update_spec`, `delete_spec`) raise `IndexNotReadyError`.

### Step 4: Refactor `server.py` — accept-first, lock, background init *(L)*

- Move `websocket.accept()` before any index/service setup.
- Add `_index_locks: dict[str, asyncio.Lock]` for per-project concurrency guard.
- If index not cached: create `SpecIndex`, cache immediately, launch `asyncio.create_task(_init_index(...))` for background initialization.
- `_init_index()`: calls `index.initialize()`, removes from cache on failure, publishes `index/ready` in `finally`.
- Import and use `load_bonsaihide()` from `core.bonsaihide`.
- Map `IndexNotReadyError` to JSON-RPC error code `-32015`.

### Step 5: Watcher `is_ready` guard *(S)*

In `_on_file_change` callback: guard `reindex_file()` with `if index.is_ready:`. Non-spec events (`files/treeChanged`, `file/didChange`) still fire unconditionally during init.

### Step 6: Frontend — handle `index/ready` *(XS)*

Add `client.on("index/ready", ...)` handler in `wireEvents.ts` → call `fetchSpecs()` and `fetchGraph()`.

### Step 7: Update tests *(M)*

- Update `TestFindMdFiles`: change all `_find_md_files(tmp_path, ["pattern"])` calls to use `pathspec.PathSpec.from_lines("gitwildmatch", ["pattern"])`.
- Add `TestInitialize`: fresh DB, existing DB match, version mismatch, corrupt DB.
- Add `TestIsReadyGuards`: service read returns empty, service write raises error.
- Remove/update tests calling `open()` + `ensure_ready()` directly.
- Add pathspec negation test (`!` patterns).

### Step 8: Manual end-to-end verification

- Delete `~/.bonsai/indexes/` → start server → open frontend: WebSocket connects immediately, spec tree empty → populates after `index/ready`.
- Test `.bonsaihide` filtering, multi-tab, reconnect scenarios.

## Files to modify

| File | Change |
|------|--------|
| `backend/app/core/bonsaihide.py` | **NEW** — `load_bonsaihide()` + `_BONSAIHIDE_DEFAULTS` extracted from `project.py` |
| `backend/app/api/routers/project.py` | Import `load_bonsaihide` from `core.bonsaihide`; remove local `_load_bonsaihide()` + `_BONSAIHIDE_DEFAULTS` |
| `backend/app/spec/index.py` | Remove `_ensure_schema()`, `ensure_ready()`. Add `initialize()`, `is_ready`, `_DROP_ALL`. Change `rebuild()` + `_find_md_files()` to accept `pathspec.PathSpec`. Add `import pathspec`. |
| `backend/app/spec/service.py` | Add `IndexNotReadyError`. Add `_require_ready()`. Guard read methods (empty return) and write methods (raise). |
| `backend/app/rpc/server.py` | Accept-first WebSocket. Per-project lock. Background init task. `index/ready` notification. `IndexNotReadyError` → `-32015`. Watcher `is_ready` guard. |
| `frontend/src/store/wireEvents.ts` | Add `index/ready` event handler → re-fetch specs + graph |
| `backend/tests/spec/test_index.py` | Update `_find_md_files` tests for `pathspec.PathSpec`. Add `TestInitialize`, `TestIsReadyGuards`. Remove `ensure_ready` tests. |

## Definition of done

- Fresh DB → `initialize()` → non-empty index, `is_ready == True` (Bug 1 fixed)
- WebSocket accepts before index init completes (Bug 2 fixed)
- `.bonsaihide` patterns applied during rebuild via `pathspec.PathSpec` (Bug 3 fixed)
- Read RPCs return empty data during init; write RPCs return `-32015` error
- `index/ready` notification triggers frontend re-fetch
- Per-project `asyncio.Lock` prevents concurrent rebuilds
- Watcher skips `reindex_file()` while `is_ready == False`
- All existing tests pass; new tests cover initialize, is_ready guards, pathspec
- `pytest backend/tests/ -x` all green

**Priority:** High
**Started:** 2026-04-23
