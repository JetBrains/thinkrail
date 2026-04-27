---
id: task-mcp-tools-rewrite
type: task-spec
status: done
title: 'Rewrite MCP tools: 7 tools → 3 (spec_search, spec_links, spec_delete)'
depends-on:
- task-service-frontmatter
implements:
- agent-tools
covers:
- backend/app/agent/tools/specs.py
- backend/app/agent/tools/__init__.py
tags:
- critical
- refactor
- frontmatter-sqlite
---
# Rewrite MCP tools: 7 tools → 3 (spec_search, spec_links, spec_delete)

Replace the current 7-tool `bonsai-specs` MCP server with 3 focused tools. Custom tools now exist only for operations standard file tools (`Read`, `Write`, `Edit`) cannot do: querying the SQLite index and performing multi-file cleanup on delete.

**Design reference:** [Frontmatter + SQLite Index Design — §MCP Tools Redesign](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#mcp-tools-redesign) and [Spec MCP Tools Design](../../.bonsai/specs/agent/tools/SPECS.md)

## Context

The current `specs.py` has 7 tools (~850 lines) that wrap all spec operations including file writes and registry mutations. With frontmatter as the source of truth, agents write spec files directly (frontmatter + content) using standard `Write`/`Edit` tools. The watcher validates and indexes automatically. Custom tools are only needed for:

1. **`spec_search`** — querying the SQLite index (agents can't run SQL)
2. **`spec_links`** — navigating the relationship graph via SQLite
3. **`spec_delete`** — coordinated multi-file cleanup (move to trash + clean dangling refs from other specs' frontmatter)

### Tools being removed

| Old Tool | Replacement |
|----------|-------------|
| `spec_list` | `spec_search` (merged with `registry_query`) |
| `spec_get` | Standard `Read` tool |
| `spec_save` | Standard `Write`/`Edit` tools |
| `registry_query` | `spec_search` |
| `registry_mutate` | Standard `Edit` + `spec_delete` |

## Plan

1. **Implement `spec_search` handler**
   - Parameters: `type?`, `status?`, `tag?`, `covers?` (all optional filters)
   - Delegate to `SpecIndex.list_specs()` with filters
   - Return `[{id, path, title, type, status, tags}]` — enough for agent to `Read` the file
   - Replaces both `spec_list` and `registry_query`

2. **Implement `spec_links` handler**
   - Parameters: `ids` (required), `direction?` (`children`, `parents`, `dependencies`, `dependents`, `all`), `link_type?`
   - Delegate to `SpecIndex.get_links()` with direction mapping
   - Return `{links: Link[], nodes: SpecSummary[]}` — links + summary of all referenced nodes
   - Direction semantics:
     - `children` → links where `type=parent` and `to_id` in `ids`
     - `parents` → links where `type=parent` and `from_id` in `ids`
     - `dependencies` → links where `type=depends-on` and `from_id` in `ids`
     - `dependents` → links where `type=depends-on` and `to_id` in `ids`
     - `all` (default) → all links involving any of the `ids`

3. **Implement `spec_delete` handler**
   - Parameter: `id` (required)
   - Steps:
     1. Look up spec in index → get file path
     2. Move file to `.bonsai/trash/` via `trash_service`
     3. Query index for all specs whose frontmatter references this ID
     4. Edit those specs' frontmatter to remove the dangling reference
     5. Watcher re-indexes changed files
     6. Return confirmation + list of cleaned files
   - Draft mode: if in `ticket-specify` session, record deletion without executing

4. **Remove old tools** — Delete `_spec_list`, `_spec_get`, `_spec_save`, `_registry_query`, `_registry_mutate` handlers and their schemas

5. **Update MCP server registration**
   ```python
   specs_mcp_server = create_sdk_mcp_server(
       name="bonsai-specs",
       tools=[_spec_search, _spec_links, _spec_delete],
   )
   ```

6. **Update `__init__.py`** — Update `MCP_SERVERS` and `INTERCEPTORS` dicts to reference new tool names

7. **Update `intercept_specs`** — Same pattern (auto-approve all), but the function now validates for the 3 new tool names

8. **Handle `SpecIndex` access** — The handler gets the index via `get_tool_context()`. The index instance must be available on the context (set by `rpc/server.py` when creating the agent).

9. **Unit tests** — Update `test_tools.py`:
   - `spec_search` with various filter combinations
   - `spec_links` with direction and type filters
   - `spec_delete` with cross-file cleanup verification
   - Verify old tool names are no longer registered

## Files to modify

- `backend/app/agent/tools/specs.py` — **Rewrite** — 3 tools replacing 7
- `backend/app/agent/tools/__init__.py` — Update tool registrations
- `backend/tests/agent/test_tools.py` — Update tool tests

## Definition of done

- Only 3 tools registered on `bonsai-specs` MCP server
- `spec_search` returns filtered results from SQLite index
- `spec_links` navigates relationships with direction semantics
- `spec_delete` performs cross-file frontmatter cleanup
- All 3 tools are auto-approved
- Old tool names (`spec_list`, `spec_get`, `spec_save`, `registry_query`, `registry_mutate`) are completely removed
- Draft mode still works for `spec_delete` in `ticket-specify` sessions
- Unit tests pass

## Style Notes

Follow conventions in `.claude/CLAUDE.md § Code Style — Python Backend`:
- Keep `_ok()`, `_json_ok()`, `_error()` helpers (clean pattern from current code)
- `@tool` decorator for each handler (existing pattern)
- Section separators: `# ── Helpers ──────`, `# ── Schemas ──────`, `# ── Tool handlers ──────`
- Auto-approve interceptor pattern unchanged
- Match existing `get_tool_context()` pattern for config/index access

**Priority:** Critical — agents cannot use new architecture without updated tools
**Depends on:** task-service-frontmatter (service must support index-based operations)
**Started:** 2026-04-16
