---
id: task-remove-registry-json-refs
type: task-spec
status: done
parent: module-spec
depends-on:
  - task-cleanup-registry-legacy
implements:
  - module-spec
tags:
  - high
  - refactor
  - backend
---

# Remove remaining registry.json references from production code and test fixtures

Follow-up to `task-cleanup-registry-legacy`: the main registry backend was removed, but several production files and test fixtures still reference `registry.json` for project detection and initialization. With frontmatter + `index.db` as the source of truth, `.bonsai/` directory existence is the correct indicator of a valid Bonsai project — not the presence of `registry.json`.

## Context

The frontmatter-replace-registry migration removed the `SpecService` registry backend, `registry.py`, and the `RegistryEntry` model. However, three production files still check for or create `registry.json`:

- **`api/deps.py`** — `valid_project_path()` rejects requests if `.bonsai/registry.json` doesn't exist. After migration, `registry.json` is archived as `.bak`, so this breaks projects that have already migrated.
- **`api/routers/project.py`** — `list_projects()` and `validate_project()` scan for `registry.json`. `init_project()` creates an empty `registry.json` on new projects (unnecessary — `ensure_project()` now handles initialization without it).
- **`core/project.py`** — `_default_registry` factory still in `_DEFAULT_FACTORIES` dict, causing `ensure_project()` to create `registry.json` on every project init.

Seven test files create `registry.json` in fixtures solely to satisfy the old "is this a valid project?" check. These need updating.

## Plan

### 1. Update `backend/app/api/deps.py`

Change `valid_project_path()` to check for `.bonsai/` directory instead of `.bonsai/registry.json`:

```python
# Before
if not (p / ".bonsai" / "registry.json").is_file():

# After
if not (p / ".bonsai").is_dir():
```

Update the docstring accordingly.

### 2. Update `backend/app/api/routers/project.py`

**`list_projects()`** — Change scan check from `registry.json` to `.bonsai/` directory:
```python
# Before
if (child / ".bonsai" / "registry.json").is_file():

# After
if (child / ".bonsai").is_dir():
```

**`validate_project()`** — Same pattern:
```python
# Before
has_specs = (p / ".bonsai" / "registry.json").is_file()

# After
has_specs = (p / ".bonsai").is_dir()
```

**`init_project()`** — Remove `registry.json` creation entirely. The `bonsai_dir.mkdir(exist_ok=True)` is sufficient for project detection, and `ensure_project()` handles meta-file creation at WebSocket connection time.

Remove `import json` if no longer used.

### 3. Update `backend/app/core/project.py`

Remove `_default_registry` factory and its entry in `_DEFAULT_FACTORIES`:
- Delete the `_default_registry()` function
- Remove `"registry.json": _default_registry` from the dict
- `ensure_project()` will no longer create `registry.json`

### 4. Update test fixtures (6 files — remove unnecessary registry.json creation)

These test files create `registry.json` only to set up a "valid project". Since project detection now uses `.bonsai/` directory, these lines can be removed:

| File | Change |
|------|--------|
| `backend/tests/trash/test_integration.py` | Remove `registry.json` write (line 14-15) |
| `backend/tests/board/test_plan.py` | Remove `registry.json` write (line 21-22) |
| `backend/tests/board/test_service.py` | Remove `registry.json` write (line 18-19) |
| `backend/tests/board/test_spec_drafts.py` | Remove `registry.json` write (line 16-17) |
| `backend/tests/rpc/test_server.py` | Remove `registry.json` write in `_make_config` fixture (line 81-82) and in `TestFrontmatterWatcher` (lines 352-354) |

### 5. Update `backend/tests/core/test_project.py`

This file tests `ensure_meta_file()` and `ensure_project()` — the functions being changed. Required updates:

- **Remove** `test_creates_registry_when_missing` — registry.json is no longer a known meta-file
- **Remove** `test_reads_existing_file` registry references — update to test settings.json or users.json instead
- **Remove** `test_creates_parent_dirs` registry.json check — use settings.json instead
- **Remove** `test_deleted_file_gets_regenerated` registry.json check — use settings.json instead
- **Update** `test_creates_all_meta_files` — remove `registry.json` assertion
- **Update** `test_never_overwrites_existing_files` — remove `registry.json` setup/assertion
- **Update** `test_registry_project_name_derived_from_dir` — remove or replace (project name is now in settings, not registry)

### 6. Keep `backend/tests/spec/test_migrate.py` unchanged

This file intentionally tests migration *from* `registry.json` to frontmatter. All `registry.json` references here are correct — the migration tool needs a registry to migrate.

### 7. Run full test suite

Run `pytest` across all 765+ tests to confirm no regressions.

## Files to modify

| File | Change |
|------|--------|
| `backend/app/api/deps.py` | `.bonsai/` dir check instead of `registry.json` |
| `backend/app/api/routers/project.py` | `.bonsai/` dir check; remove `init_project` registry creation; remove `json` import |
| `backend/app/core/project.py` | Remove `_default_registry` factory and dict entry |
| `backend/tests/core/test_project.py` | Remove/update registry-specific test cases |
| `backend/tests/trash/test_integration.py` | Remove fixture `registry.json` write |
| `backend/tests/board/test_plan.py` | Remove fixture `registry.json` write |
| `backend/tests/board/test_service.py` | Remove fixture `registry.json` write |
| `backend/tests/board/test_spec_drafts.py` | Remove fixture `registry.json` write |
| `backend/tests/rpc/test_server.py` | Remove fixture `registry.json` writes (2 locations) |

**No change:** `backend/tests/spec/test_migrate.py`, `backend/app/spec/migrate.py` (migration tool is still needed)

## Definition of done

- No references to `registry.json` in production code (`backend/app/`) except `spec/migrate.py`
- Test fixtures no longer create `registry.json` for project setup (except `test_migrate.py`)
- `core/project.py` `_DEFAULT_FACTORIES` no longer includes `registry.json`
- `api/deps.py` and `api/routers/project.py` detect projects via `.bonsai/` directory
- `init_project()` no longer creates `registry.json`
- All tests pass (765+ tests)
- Changes committed on `frontmatter-replace-registry` branch

**Priority:** High — migrated projects currently break `valid_project_path()` because `registry.json` is archived
**Started:** 2026-04-20