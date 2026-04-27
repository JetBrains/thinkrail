---
id: agent-specs-tools
type: submodule-design
status: active
title: Spec MCP Tools — Design Specification
parent: agent-tools
depends-on:
- module-spec
covers:
- backend/app/agent/tools/specs.py
tags:
- backend
- agent-orchestration
- mcp-tools
---
# Spec MCP Tools — Design Specification

> Parent: [Agent Tools](README.md) | Status: **Active** | Created: 2026-03-16 | Updated: 2026-04-16

## Purpose

A single MCP server (`bonsai-specs`) exposing **3 tools** that give the Claude agent structured access to the spec index. These tools exist only for operations that standard file tools (`Read`, `Write`, `Edit`, `Glob`) cannot do: querying the SQLite index and performing multi-file cleanup on delete.

Agents create and edit spec files directly using standard `Write`/`Edit` tools — writing YAML frontmatter + Markdown content. The file watcher validates and indexes changes automatically.

**File:** `backend/app/agent/tools/specs.py`
**MCP server name:** `bonsai-specs`
**Architecture rationale:** [Frontmatter + SQLite Index Design](../../../../.bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md)

---

## Why 3 Tools (not 7)

Previously, 7 MCP tools (`spec_list`, `spec_get`, `spec_save`, `spec_delete`, `spec_links`, `registry_query`, `registry_mutate`) wrapped all spec operations. This was necessary because metadata lived in `registry.json` — a file agents couldn't safely edit.

With frontmatter as the source of truth, agents can read and write spec files directly. Custom tools now serve only two purposes:

1. **Index queries** — finding specs by filters and navigating relationships (requires SQLite)
2. **Coordinated delete** — removing a spec and cleaning dangling references from other specs' frontmatter

---

## Tool Inventory

| Tool | Type | Approval | Purpose |
|------|------|----------|---------|
| `spec_search` | Read | Auto | Find specs by type, status, tag, or covered path |
| `spec_links` | Read | Auto | Navigate relationships from known specs |
| `spec_delete` | Write | Auto (validated) | Delete spec + cleanup cross-file references |

---

## Schemas

### spec_search

Discover specs the agent doesn't already know about. Returns summaries — agent uses `Read` for full content.

```python
SPEC_SEARCH_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "enum": ["goal-and-requirements", "architecture-design",
                     "module-design", "submodule-design", "task-spec"],
            "description": "Filter by spec type",
        },
        "status": {
            "type": "string",
            "enum": ["draft", "active", "stale", "done", "deprecated"],
            "description": "Filter by lifecycle status",
        },
        "tag": {
            "type": "string",
            "description": "Filter by tag (exact match)",
        },
        "covers": {
            "type": "string",
            "description": "Filter by covered source path prefix",
        },
    },
}
```

**Returns:** JSON array of `{id, path, title, type, status, tags}`.

**Replaces:** `spec_list` + `registry_query`

---

### spec_links

Navigate relationships from known specs via the SQLite index.

```python
SPEC_LINKS_SCHEMA = {
    "type": "object",
    "required": ["ids"],
    "properties": {
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Spec IDs to get links for",
        },
        "direction": {
            "type": "string",
            "enum": ["children", "parents", "dependencies", "dependents", "all"],
            "description": "Filter link direction (default: 'all')",
        },
        "link_type": {
            "type": "string",
            "enum": ["parent", "depends-on", "references", "implements"],
            "description": "Filter to a specific link type (optional)",
        },
    },
}
```

**Returns:** JSON `{ links: Link[], nodes: SpecSummary[] }` — matching links plus summary entries for all referenced nodes.

**Replaces:** `spec_links` (same name, simplified)

---

### spec_delete

Delete a spec with multi-file cleanup.

```python
SPEC_DELETE_SCHEMA = {
    "type": "object",
    "required": ["id"],
    "properties": {
        "id": {
            "type": "string",
            "description": "Spec ID to delete",
        },
    },
}
```

**Cleanup steps:**
1. Move file to `.bonsai/trash/` (soft-delete, restorable)
2. Find all other specs whose frontmatter references this ID → edit their frontmatter to remove the reference
3. Watcher re-indexes all changed files
4. Push `spec/didDelete` + `spec/didUpdate` for cleaned specs

**Returns:** Confirmation with list of cleaned files.

**Replaces:** `spec_delete` (same name, added cross-file cleanup)

---

## Removed Tools

| Old Tool | Replacement | Rationale |
|----------|-------------|-----------|
| `spec_list` | `spec_search` | Merged with `registry_query` into one search tool |
| `spec_get` | Standard `Read` tool | Agent gets path from `spec_search`, reads file directly |
| `spec_save` | Standard `Write`/`Edit` tools | Agent writes frontmatter + content. Watcher validates and indexes. |
| `registry_query` | `spec_search` | Same capability, better name |
| `registry_mutate` | Standard `Edit` + `spec_delete` | Links live in frontmatter — agent edits files directly |

---

## Interception & Permissions

All 3 tools are **auto-approved** with server-side validation. Same pattern as before — `intercept_specs()` returns `PermissionResultAllow` immediately.

```python
INTERCEPTORS: dict[str, InterceptFn] = {
    "spec_search": intercept_specs,
    "spec_links": intercept_specs,
    "spec_delete": intercept_specs,
}
```

---

## Draft Mode (ticket-specify sessions)

When a session has `skill_id == "ticket-specify"` AND `meta_ticket_id` is set, spec tools enter **draft mode** — detected by `_is_draft_mode()` helper which checks `get_tool_context().task`.

| Tool | Draft behavior |
|------|---------------|
| `spec_delete` | Records deletion in draft manifest via `SpecDraftService.record_delete()`. Real file is NOT deleted. |
| `spec_search` | Normal behavior (reads index as usual) |
| `spec_links` | Normal behavior (reads index as usual) |

The `SpecDraftService` is accessed via `BoardService(config).spec_drafts`. After the session, the user reviews diffs in the `TicketDraftsView` frontend component and applies/discards drafts selectively.

See also: `backend/app/board/spec_drafts.py` (SpecDraftService).

---

## Data Flow

### Read path (spec_search, spec_links)

```
Agent calls tool
  → MCP handler receives args
  → _index_service() yields SpecService from ToolContext (cached, reuses server's index connection)
  → Falls back to fresh SpecIndex connection if ToolContext has no service (tests, edge cases)
  → Query SQLite index.db via SpecService
  → Filter/transform response
  → Return JSON as MCP text content
```

### Delete path (spec_delete)

```
Agent calls spec_delete(id)
  → MCP handler checks ToolContext for coordinator
  → If coordinator available (normal operation):
      → coordinator.request_delete(spec_id) enqueues SpecDeleteRequested
      → Coordinator's single consumer processes the event:
        → SpecService.delete_spec(): move file to trash, clean dangling refs
        → Emit spec/didDelete notification
        → Resolve future → tool returns confirmation to agent
  → If no coordinator (fallback for tests):
      → Direct SpecService.delete_spec() call
      → Return confirmation + list of cleaned files
```

### Write path (agent uses standard tools)

```
Agent uses Write/Edit tool to create/modify spec file
  → File watcher detects change
  → Watcher emits FileChanged event to IndexCoordinator
  → Coordinator's single consumer calls reindex_file()
  → Frontmatter parser extracts metadata, upserts into SQLite
  → Coordinator emits notification (spec/didChange or docs/didChange)
  → Validation runs in parallel (spec/validationError if invalid)
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **3 tools, not 7** | Only tools for operations standard file tools can't do | Agents already have Read/Write/Edit. Fewer tools = less decision overhead. |
| **No spec_save** | Agent writes frontmatter directly | Frontmatter is the source of truth. Agent controls the full file. Skills teach the format. |
| **No registry_mutate** | Links in frontmatter, edited via Edit tool | No central registry to mutate. Batch operations = sequential file edits. |
| **Auto-approve all** | No Future-based suspension | Same as before — validation catches errors without blocking. |
| **Service + coordinator via contextvars** | Handler reads `get_tool_context().spec_service` (cached) and `coordinator` for serialized mutations | Reuses the server's cached `SpecIndex` connection — zero overhead per tool call. `spec_delete` routes through the coordinator for serialized index mutations. Falls back to direct service call for tests. |

---

## Known Limitations

- **No pagination** — `spec_search` returns all matching entries. Fine for current scale, may need pagination at 500+ specs.
- **No content search** — Cannot grep within spec content. Agent uses `Grep` tool for that.
- **Delete cleanup is best-effort** — If a spec references a deleted ID in Markdown body (not frontmatter links), the reference won't be cleaned.
- **Fallback fresh connections** — When `ToolContext.spec_service` is `None` (tests, edge cases), `_index_service()` opens a fresh `SpecIndex` connection with full overhead (PRAGMAs, schema check). This is the same behavior as before the connection reuse fix and is only expected in test scenarios.

---

## Related Specs

- **Parent:** [Agent Tools](README.md)
- **Architecture:** [Frontmatter + SQLite Index Design](../../../../.bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md)
- **Wraps:** [Spec Module](../../spec/README.md)
- **Sibling tools:** [Visualization](VISUALIZATION.md), [SuggestSession](SUGGEST_SESSION.md)
