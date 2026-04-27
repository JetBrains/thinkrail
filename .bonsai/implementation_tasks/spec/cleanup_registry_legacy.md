---
id: task-cleanup-registry-legacy
type: task-spec
status: done
parent: module-spec
depends-on:
  - task-frontmatter
  - task-index
  - task-service-frontmatter
  - task-mcp-tools-rewrite
  - task-migration-tool
tags:
  - backend
  - cleanup
---

# Remove legacy registry.py and dual-backend code

Remove the old `registry.json`-based metadata system after confirming all projects have migrated to frontmatter + SQLite index. This is a cleanup task — not a feature. The dual-backend architecture was a migration bridge; once all projects use `index.db`, the legacy path can be deleted.

**Prerequisite:** All active projects must have run `migrate_registry()` (registry.json archived as `.bak`, frontmatter injected, index.db built). Verify by checking no `.bonsai/registry.json` files exist across known deployments.

## Current State

The codebase runs dual-mode: `SpecService` dispatches to index or registry backend based on whether a `SpecIndex` was injected. This means every read/write path has two implementations that must stay in sync.

## Plan

### Phase 1: Migrate remaining registry consumers to index

1. **`vis/service.py`** — Currently imports `read_registry` directly and reads `registry.json` for dashboard computation. Refactor to accept a `SpecIndex` (or `SpecService`) and query the SQLite index instead.

2. **`agent/tools/suggest_session.py`** — `_validate_spec_ids()` reads registry to check if spec IDs exist. Refactor to use `SpecIndex.get_spec()` or `SpecService.get_spec()` via tool context.

3. **`rpc/server.py` watcher callback** — Three registry-specific behaviors:
   - Watches `registry.json` file changes → emits `registry/didUpdate` notification (remove)
   - Uses `register_existing()` for auto-discovery (replace with frontmatter-based discovery)
   - `_validate_frontmatter_and_notify()` already added — this is the replacement path

### Phase 2: Remove legacy backend from SpecService

4. **Remove sync convenience methods** — `list_specs_sync()`, `get_spec_sync()`, `create_spec_sync()`, `update_spec_sync()`, `delete_spec_sync()`, `get_graph_sync()`. These always use the registry backend. Callers must be migrated to async.

5. **Remove registry backend methods** — `_list_specs_registry()`, `_get_spec_registry()`, `_create_spec_registry()`, `_update_spec_registry()`, `_delete_spec_registry()`, `_get_graph_registry()`.

6. **Remove `register_existing()`** — No longer needed when the index auto-discovers from frontmatter.

7. **Make `index` required** — Change `SpecService.__init__(config, index)` from optional to required parameter.

8. **Remove dual-dispatch** — Each public method no longer needs `if self._index is not None:` branching.

### Phase 3: Delete registry module

9. **Delete `backend/app/spec/registry.py`** — All 88 lines (read_registry, write_registry, find_entry, add_entry, remove_entry).

10. **Remove `RegistryEntry` from `models.py`** — If no remaining consumers. Check `validator.py` which currently takes `RegistryEntry` — update to use `SpecEntry` or frontmatter dict.

11. **Update `validator.py`** — `validate_spec()` takes `(Spec, RegistryEntry)`. Refactor to validate from frontmatter dict or `SpecEntry` directly. `validate_links()` takes `list[RegistryEntry]` — refactor to `list[SpecEntry]`.

12. **Remove `get_registry_path()` from `AppConfig`** — No more consumers.

13. **Remove `registry/didUpdate` notification** — Frontend must also stop listening for it.

### Phase 4: Cleanup

14. **Update test files:**
    - `test_registry.py` — Delete entirely
    - `test_service.py` — Remove all sync test classes, keep async index tests
    - `test_tools.py` — Remove `_write_registry()` helper, update fixtures to use frontmatter
    - `test_server.py` — Remove registry.json watcher tests, update remaining tests

15. **Update documentation:**
    - `backend/app/spec/README.md` (module design spec) — Remove references to registry mode
    - `backend/app/agent/tools/SPECS_TOOLS.md` — Already documents migration, can clean "Removed Tools" section

16. **Remove migration tool references** — After sufficient time, `migrate.py` can be deprecated (but keep for safety).

## Files to modify

| File | Change |
|------|--------|
| `backend/app/spec/registry.py` | **DELETE** |
| `backend/app/spec/models.py` | Remove `RegistryEntry` |
| `backend/app/spec/service.py` | Remove dual-backend, make index required |
| `backend/app/spec/validator.py` | Refactor to use `SpecEntry` / frontmatter |
| `backend/app/vis/service.py` | Migrate to SpecIndex |
| `backend/app/agent/tools/suggest_session.py` | Migrate to SpecIndex |
| `backend/app/rpc/server.py` | Remove registry.json watcher, register_existing |
| `backend/app/core/config.py` | Remove `get_registry_path()` |
| `backend/tests/spec/test_registry.py` | **DELETE** |
| `backend/tests/spec/test_service.py` | Remove sync tests |
| `backend/tests/spec/test_validator.py` | Update for SpecEntry |
| `backend/tests/agent/test_tools.py` | Remove registry fixtures |
| `backend/tests/rpc/test_server.py` | Remove registry watcher tests |

## Definition of done

- `registry.py` deleted
- `RegistryEntry` model removed
- No imports of `from app.spec.registry` anywhere
- No references to `registry.json` in production code (test migration fixtures OK)
- `SpecService.__init__` requires `index` parameter (not optional)
- All sync convenience methods removed
- `vis/service.py` reads from SQLite index
- `suggest_session.py` validates via index
- `get_registry_path()` removed from config
- All tests pass
- Frontend no longer depends on `registry/didUpdate` notification

## Risk assessment

- **Low risk:** All new code paths are already implemented and tested. This task only removes the old paths.
- **Migration dependency:** Must verify no project still relies on `registry.json` before executing.
- **Frontend coordination:** The `registry/didUpdate` notification removal requires a frontend change. Can be done in parallel.

**Priority:** Medium — not blocking any features, but reduces maintenance burden
**Depends on:** All frontmatter+index tasks complete (they are)
