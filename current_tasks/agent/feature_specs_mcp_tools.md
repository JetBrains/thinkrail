# Implement Spec & Registry MCP Tools

Implement the `bonsai-specs` MCP server with 7 tools that give the Claude agent structured, validated access to the spec registry and spec files. This replaces raw file I/O (Read/Edit on `.bonsai/registry.json`) with typed operations that enforce correctness and minimize token usage.

The design spec is at `backend/app/agent/tools/SPECS_TOOLS.md`. All tools are thin MCP wrappers delegating to the existing `SpecService` and `registry` modules — no new business logic in the spec module.

## Plan

### 1. Create `backend/app/agent/tools/specs.py`

Implement in this order (each tool follows the established schema + handler + intercept pattern from `visualization.py`):

**Intercept function (shared by all 7 tools):**
- Single `intercept_specs()` that auto-approves all calls
- Inject `AppConfig` via `updated_input["_config"]` so handlers can instantiate `SpecService`

**Read tools (auto-approve, no side effects):**

1. **`spec_list`** — Call `SpecService.list_specs()`, filter by `type`, `status`, `tag` params. Return JSON array of `SpecSummary` objects (serialized via `model_dump()`).

2. **`spec_get`** — Call `SpecService.get_spec(id)`. Return JSON `SpecDetail`. Catch `SpecNotFoundError` → `isError: true`.

3. **`spec_links`** — Call `read_registry()` to get all links, filter by `ids`, `link_type`, `direction`. Collect referenced node entries for all `from`/`to` IDs in matching links. Return `{ links: [...], nodes: [...] }`. Validate that requested IDs exist → `isError: true` if missing.

4. **`registry_query`** — Call `read_registry()`, apply filters: `type`, `status`, `tag` (entry has tag), `covers` (entry covers path prefix), `ids` (entry in ID list). Optionally include related links if `include_links: true`. Return `{ entries: [...], links?: [...] }`.

**Write tools (auto-approve, validated):**

5. **`spec_save`** — Upsert logic:
   - Check if `path` matches an existing registry entry.
   - If exists: call `SpecService.update_spec(id, content)`. If `status`/`covers`/`tags` provided, read registry, update those fields on the entry, write registry.
   - If new: require `type`, call `SpecService.create_spec(type, path, content, id)`. If `status`/`covers`/`tags` provided, read-modify-write the entry after creation.
   - Catch `ValueError`, `SpecNotFoundError` → `isError: true`.

6. **`spec_delete`** — Call `SpecService.delete_spec(id)`. Catch `SpecNotFoundError` → `isError: true`. Return confirmation message.

7. **`registry_mutate`** — Batch operations in order: remove → add → update.
   - Read current registry via `read_registry()`.
   - Apply `remove_entries`: remove each entry + auto-clean links referencing it.
   - Apply `remove_links`: match on (from, to, type) exact.
   - Apply `add_entries`: create `RegistryEntry` objects, add via `add_entry()`. Auto-set `created`/`updated` to today.
   - Apply `add_links`: create `Link` objects, append.
   - Apply `update_entries`: find entry by ID, merge only provided fields, set `updated` to today.
   - Validate final state via `validate_links()` — check all link targets exist, no self-links, recognized types.
   - Atomic `write_registry()` if valid. Return counts.
   - If validation fails → `isError: true` with details. No partial apply.

**MCP server:**
- `specs_mcp_server = create_sdk_mcp_server(name="bonsai-specs", tools=[...all 7 handlers...])`

### 2. Update `backend/app/agent/tools/__init__.py`

- Import `specs_mcp_server` and `intercept_specs` from `specs.py`
- Add `"bonsai-specs": specs_mcp_server` to `MCP_SERVERS`
- Add 7 entries to `INTERCEPTORS` (one per tool name, all pointing to `intercept_specs`)

### 3. Write tests in `backend/tests/agent/test_tools.py`

Add a new test section for specs tools. Follow the existing test patterns (`_make_config`, `_make_tracker_and_task`, `_write_registry`):

**spec_list tests:**
- Returns all specs when no filters
- Filters by type, status, tag
- Returns empty list when no matches

**spec_get tests:**
- Returns full spec content + links for valid ID
- Returns `isError` for unknown ID

**spec_save tests:**
- Creates new spec (new path + type) — file written + registry entry added
- Updates existing spec (matching path) — file content updated, timestamp refreshed
- Upsert with `status`/`covers`/`tags` — metadata fields applied
- Returns `isError` for missing type on create
- Returns `isError` for duplicate ID

**spec_delete tests:**
- Deletes spec + entry + cleans orphaned links
- Returns `isError` for unknown ID

**spec_links tests:**
- Returns matching links for given IDs
- Filters by `link_type` and `direction`
- Returns referenced node summaries alongside links
- Returns `isError` for unknown IDs

**registry_query tests:**
- Filters by type, status, tag, covers, ids
- `include_links: true` adds related links
- Returns empty when no matches

**registry_mutate tests:**
- Batch add entries + links atomically
- Batch remove entries + auto-clean links
- Batch update entries (partial field merge)
- Validates final state — rejects broken links
- Returns counts summary
- Returns `isError` and no writes when validation fails

## Files to modify

| File | Change |
|------|--------|
| `backend/app/agent/tools/specs.py` | **NEW** — 7 tool schemas, 7 handlers, 1 MCP server, 1 intercept function |
| `backend/app/agent/tools/__init__.py` | **MODIFY** — register bonsai-specs server + 7 interceptor entries |
| `backend/tests/agent/test_tools.py` | **MODIFY** — add spec tools test section (~20 test cases) |

## Definition of done

- All 7 tool handlers implemented following the schema in SPECS_TOOLS.md
- `specs_mcp_server` registered in `MCP_SERVERS` and all tool names in `INTERCEPTORS`
- Unit tests pass for every tool's happy path and error cases
- No modifications to `backend/app/spec/` — tools are pure wrappers
- Existing tests continue to pass (`pytest backend/tests/`)

**Priority:** High
**Type:** New feature
**Started:** 2026-03-16
