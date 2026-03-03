# Implement Core fileio.py

> File read, write, delete, and directory operations

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Spec reference:** `backend/app/core/README.md`

## Files to Modify

- `backend/app/core/fileio.py`

## Summary

`fileio.py` centralizes all filesystem operations used by domain modules (primarily `spec/`). It wraps pathlib calls with consistent error handling and automatic parent directory creation.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `read_text` | `(path: Path) → str` | Read file contents as text |
| `write_text` | `(path: Path, content: str) → None` | Write text, create parents if needed |
| `delete_file` | `(path: Path) → None` | Delete a file |
| `ensure_dir` | `(path: Path) → None` | Create directory and all parents |

## Plan

1. Implement `read_text()` with `FileNotFoundError` handling
2. Implement `write_text()` with automatic parent directory creation
3. Implement `delete_file()` with appropriate error handling
4. Implement `ensure_dir()` using `Path.mkdir(parents=True, exist_ok=True)`
5. Export from `__init__.py`
6. Write unit tests using `tmp_path` fixture

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/core/fileio.py` | Create | Main implementation |
| `backend/app/core/__init__.py` | Update | Add fileio exports |
| `tests/core/test_fileio.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
