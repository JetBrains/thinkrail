# Implement Core watcher.py

> Async filesystem watching with callback dispatch

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Spec reference:** `backend/app/core/README.md`

## Summary

`watcher.py` detects file changes in the working directory and fires callbacks. Primary consumers are spec files (`*.md`, `*.json`), `.specs/*`, and `registry.json`. The RPC module's `server.py` will register a callback to handle change events.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `watch` | `(paths: list[Path], callback: Callable) → WatchHandle` | Start watching |
| `stop` | `(handle: WatchHandle) → None` | Stop watching |

### Models

- **WatchHandle** (opaque) — handle to a running file watch

## Design Notes

- Use `watchfiles` (preferred) or `watchdog` as the underlying library
- Callback receives change type and file path
- Must be async-compatible (used in an asyncio event loop)
- Watch the entire working directory; filter by file patterns in the callback layer

## Plan

1. Choose and configure `watchfiles` dependency
2. Define `WatchHandle` type (wraps the async watch task)
3. Implement `watch()` — start an asyncio task running `watchfiles.awatch()`
4. Implement `stop()` — cancel the async task cleanly
5. Export from `__init__.py`
6. Write unit tests using `tmp_path` and async test fixtures

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/core/watcher.py` | Create | Main implementation |
| `backend/app/core/__init__.py` | Update | Add watcher exports |
| `tests/core/test_watcher.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
