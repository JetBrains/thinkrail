# Unit tests for Agent persistence.py

> Test the split storage persistence layer (metadata .json + events .events.jsonl)

**Status:** Done
**Priority:** Medium
**Spec reference:** `backend/app/agent/PERSISTENCE.md`

## Files to Modify

- `backend/tests/agent/test_persistence.py` (new)

## Summary

Add unit tests for all five public functions in `persistence.py`. Tests use a `tmp_path` fixture as `project_root` — no real filesystem side effects. Verify the split storage model: metadata goes to `.json`, events go to `.events.jsonl`, and `load_session` recombines them.

## Test Cases

### `save_session`

| Test | Description |
|------|-------------|
| `test_save_creates_metadata_file` | Saves data with taskId, verifies `{taskId}.json` exists and contains metadata without events key |
| `test_save_strips_events_to_jsonl` | Saves data with `events` list, verifies events are written to `{taskId}.events.jsonl` (one per line) and not in `.json` |
| `test_save_empty_task_id_noop` | Passes `data` with empty `taskId`, verifies no file is created |
| `test_save_creates_sessions_dir` | Saves to a fresh `project_root`, verifies `.bonsai/sessions/` directory is created |

### `load_session`

| Test | Description |
|------|-------------|
| `test_load_combines_metadata_and_events` | Save metadata + events separately, then load — verify returned dict has both metadata fields and `events` list |
| `test_load_missing_returns_none` | Load a non-existent task_id, verify returns `None` |
| `test_load_metadata_only_no_events` | Save metadata without events file, load — verify `events` is empty list |
| `test_load_malformed_json_returns_none` | Write invalid JSON to metadata file, verify returns `None` and logs error |

### `list_sessions`

| Test | Description |
|------|-------------|
| `test_list_returns_metadata_only` | Save two sessions with events, list — verify events are not in results |
| `test_list_sorted_by_mtime` | Save sessions with different mtimes, verify newest first |
| `test_list_empty_dir` | List from empty sessions dir, verify returns empty list |
| `test_list_fields` | Verify all 10 metadata fields are present in each entry |

### `append_event`

| Test | Description |
|------|-------------|
| `test_append_creates_jsonl_file` | Append to a session that has no events file yet, verify file is created with one line |
| `test_append_adds_line` | Append three events, verify `.events.jsonl` has three lines, each valid JSON |
| `test_append_does_not_touch_metadata` | Append event, verify `.json` metadata file is unchanged |
| `test_append_missing_session_noop` | Append to non-existent session, verify no error and no file created |

### `delete_session`

| Test | Description |
|------|-------------|
| `test_delete_removes_both_files` | Save metadata + events, delete — verify both `.json` and `.events.jsonl` are removed |
| `test_delete_metadata_only` | Save metadata without events, delete — verify returns `True` |
| `test_delete_nonexistent_returns_false` | Delete non-existent task_id, verify returns `False` |

### Round-trip

| Test | Description |
|------|-------------|
| `test_save_load_roundtrip` | Save a full session with events, load it back, verify data matches |
| `test_save_append_load_roundtrip` | Save session, append 3 events, load — verify original events + appended events are all present |

## Implementation Notes

- Use `pytest` with `tmp_path` fixture
- No mocking of `core/fileio` — test against real filesystem via tmp_path
- Test file: `backend/tests/agent/test_persistence.py`
- Run with: `uv run pytest backend/tests/agent/test_persistence.py -v`
