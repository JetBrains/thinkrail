# Improve spec_save: make content optional for updates (registry-sync path)

After editing a spec file with the Edit tool, agents currently must re-read the entire file and pass full content to `spec_save` just to sync the registry. This wastes tokens (~2-20KB per call) and creates an awkward 3-step workflow (Edit file → Read file → spec_save with full content). This improvement makes `content` optional on updates — when omitted, `spec_save` reads from disk and syncs the registry without rewriting the file.

## Context

The `spec_save` MCP tool currently requires `content` as a mandatory parameter. For creates this is correct — you need to provide the file content. But for updates, this forces agents to re-read and re-send content they just edited via the Edit tool. The design spec (`SPECS_TOOLS.md`) has been updated to document the new behavior.

**Approach chosen:** Make `content` optional (Option 1). When path matches an existing entry and content is omitted, `spec_save` reads from disk. Alternatives rejected: metadata-only mode (adds cognitive load, risks drift), extending `registry_mutate` (breaks separation of concerns).

## Plan

### 1. Update `SPEC_SAVE_SCHEMA` in `specs.py`

- Remove `"content"` from the `"required"` array (change `["path", "content"]` → `["path"]`)
- Update the `content` field description to document the optional behavior

### 2. Refactor `_spec_save` handler — update branch

In the existing entry (update) branch:

- If `content` is provided: keep current behavior (call `svc.update_spec(existing.id, content)`)
- If `content` is omitted:
  1. Read the file from disk using the parser (`parse_spec` or direct file read via `config.project_root / path`)
  2. Extract title from the on-disk content (first `# heading`)
  3. Update the registry entry's `title` and `updated` timestamp
  4. Apply any provided metadata (status, covers, tags)
  5. Write registry atomically
  6. Return `SpecDetail` with on-disk content (via `svc.get_spec()`)

### 3. Refactor `_spec_save` handler — create branch

- If `content` is omitted on create: return `isError: true` with message "Missing 'content' for new spec (required when path is new)"
- Keep existing create logic unchanged when content is provided

### 4. Clean up redundant registry reads

The current handler reads the registry 2-3 times during a single update with metadata changes. Refactor to:
- Read registry once at the start
- Apply all changes (content update + metadata) to in-memory entries
- Write registry once at the end

### 5. Add tests in `test_tools.py`

**New test cases for the registry-sync path:**
- `test_spec_save_update_without_content` — Update existing spec with only metadata (status, tags), verify file is unchanged, registry is updated
- `test_spec_save_update_without_content_title_sync` — Edit file to change `# heading`, call spec_save without content, verify registry title is re-derived from disk
- `test_spec_save_create_without_content_fails` — Attempt to create new spec without content, expect `isError: true`
- `test_spec_save_update_without_content_missing_file` — Entry exists but file is missing on disk, expect `isError: true`

**Verify existing tests still pass:**
- All existing `test_spec_save_*` tests should be unchanged (they provide content)

## Files to modify

| File | Change |
|------|--------|
| `backend/app/agent/tools/specs.py` | **MODIFY** — Update `SPEC_SAVE_SCHEMA` (remove content from required), refactor `_spec_save` handler for content-omitted path, clean up redundant registry reads |
| `backend/tests/agent/test_tools.py` | **MODIFY** — Add 4 new test cases for registry-sync path |

## Definition of done

- All new tests pass (`test_spec_save_update_without_content*`, `test_spec_save_create_without_content_fails`)
- All existing spec_save tests continue to pass unchanged
- Full test suite passes (`pytest backend/tests/`)

**Priority:** High
**Type:** Improvement
**Started:** 2026-03-16