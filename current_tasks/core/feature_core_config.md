# Implement Core config.py

> Project root discovery, paths, and AppConfig model

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Spec reference:** `backend/app/core/README.md`

## Summary

The Core module is the foundational dependency for all backend modules. `config.py` provides project root discovery, canonical directory paths, and application settings. Without it, no other module can locate files or load configuration.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `get_project_root` | `() → Path` | Discover project root (look for `.specs/` or `.git/`) |
| `get_spec_dir` | `() → Path` | Return `<root>/.specs/` |
| `get_registry_path` | `() → Path` | Return `<root>/.specs/registry.json` |
| `load_config` | `() → AppConfig` | Load and validate application settings |

### Models

- **AppConfig** (Pydantic BaseModel) — fields: `project_root`, `spec_dir`, `host`, `port`

## Plan

1. Create `backend/app/core/__init__.py` with public exports
2. Implement `AppConfig` Pydantic model in `config.py`
3. Implement `get_project_root()` — walk up from cwd looking for `.specs/` or `.git/`
4. Implement `get_spec_dir()` and `get_registry_path()` using `get_project_root()`
5. Implement `load_config()` — construct AppConfig with discovered paths and defaults
6. Write unit tests covering: root discovery, path construction, config validation

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/core/config.py` | Create | Main implementation |
| `backend/app/core/__init__.py` | Create | Module exports |
| `tests/core/test_config.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
