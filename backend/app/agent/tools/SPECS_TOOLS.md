# Spec & Registry MCP Tools — Design Specification

> Parent: [Agent Tools](README.md) | Status: **Active** | Created: 2026-03-16

## Table of Contents

1. [Purpose](#purpose)
2. [Why This Exists](#why-this-exists)
3. [Architecture](#architecture)
4. [Tool Inventory](#tool-inventory)
5. [Schemas](#schemas)
6. [Interception & Permissions](#interception--permissions)
7. [Output Contract](#output-contract)
8. [Data Flow](#data-flow)
9. [Design Decisions](#design-decisions)
10. [Known Limitations](#known-limitations)
11. [Related Specs](#related-specs)

---

## Purpose

A single MCP server (`bonsai-specs`) exposing 7 tools that give the Claude agent structured, validated access to the spec registry and spec files. Replaces raw file I/O (Read/Edit on `.specs/registry.json`) with typed operations that enforce correctness and minimize token usage.

**File:** `backend/app/agent/tools/specs.py`
**MCP server name:** `bonsai-specs`

---

## Why This Exists

**Co-equal drivers: token efficiency + correctness.**

Today, 12 of 14 skills read the full 82KB `registry.json` via the Read tool (~20K tokens consumed per read). 8 skills write registry entries via the Edit tool with no validation — no duplicate-ID checks, no link integrity, no type enforcement. Creating a spec requires 2+ separate file operations (Write file → Edit registry) with no atomicity guarantee.

These MCP tools solve both problems:
- **Token efficiency:** Filtered queries return only matching entries (~500 tokens vs ~20K).
- **Correctness:** All mutations are validated (recognized types, unique IDs, link integrity) and written atomically.

---

## Architecture

### Single server, single file

All 7 tools live in one file (`specs.py`) under one MCP server (`bonsai-specs`). This follows the parent module's graduation rule: start as a single file, graduate to a top-level package if complexity warrants it.

```
backend/app/agent/tools/
├── __init__.py              ← registers bonsai-specs in MCP_SERVERS + INTERCEPTORS
├── _context.py              ← contextvars: set_tool_context / get_tool_context
├── specs.py                 ← 7 tools, 1 MCP server, 1 intercept function
├── visualization.py         ← existing
├── suggest_session.py       ← existing
└── SPECS_TOOLS.md           ← this spec
```

### Delegation pattern

Tools are thin MCP wrappers — all business logic is delegated to existing modules:

```
specs.py tools
    ↓
SpecService (app.spec.service)  — CRUD + graph
Registry    (app.spec.registry) — read/write/find/add/remove
Validator   (app.spec.validator) — validate_spec, validate_links
Graph       (app.spec.graph)    — build_graph, get_children, etc.
```

No new business logic is introduced. The tools handle schema definition, input validation, response formatting, and MCP protocol compliance.

---

## Tool Inventory

| Tool | Type | Approval | Wraps | Primary consumers |
|------|------|----------|-------|-------------------|
| `spec_list` | Read | Auto | `SpecService.list_specs()` | spec-status, spec-next, cli-progress, visualisation |
| `spec_get` | Read | Auto | `SpecService.get_spec()` | module-design, submodule-design, task-spec, spec-review |
| `spec_save` | Write | Auto (validated) | `SpecService.create_spec()` / `update_spec()` | goal-and-req, architecture, module, submodule, task-spec, spec-init |
| `spec_delete` | Write | Auto (validated) | `SpecService.delete_spec()` | registry-update |
| `spec_links` | Read | Auto | `read_registry()` + link filtering | architecture-design, module-design, spec-next, visualisation |
| `registry_query` | Read | Auto | `read_registry()` + filtering | spec-status, spec-next, cli-progress, spec-from-code |
| `registry_mutate` | Write | Auto (validated) | `add_entry()`, `remove_entry()`, `write_registry()` | All spec-creating skills, registry-update, spec-lint |

---

## Schemas

### spec_list

List specs with optional filtering. Returns summaries (no content).

```python
SPEC_LIST_SCHEMA = {
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
            "description": "Filter by status",
        },
        "tag": {
            "type": "string",
            "description": "Filter by tag (exact match)",
        },
    },
}
```

**Returns:** JSON array of `SpecSummary` objects (id, type, path, status, title, tags, covers, created, updated).

---

### spec_get

Get one spec's full content + metadata + related links.

```python
SPEC_GET_SCHEMA = {
    "type": "object",
    "required": ["id"],
    "properties": {
        "id": {
            "type": "string",
            "description": "Spec ID to retrieve",
        },
    },
}
```

**Returns:** JSON `SpecDetail` object (id, type, path, status, title, tags, content, links).

**Errors:** `isError: true` if spec ID not found.

---

### spec_save

Create or update a spec file and its registry entry atomically. If the path matches an existing entry, updates it; otherwise creates new.

```python
SPEC_SAVE_SCHEMA = {
    "type": "object",
    "required": ["path"],
    "properties": {
        "path": {
            "type": "string",
            "description": "Relative path from project root (e.g. 'backend/app/foo/README.md')",
        },
        "content": {
            "type": "string",
            "description": "Full spec file content (Markdown). "
                "Required for new specs. Optional for updates — when omitted, "
                "spec_save reads current content from disk and syncs the registry "
                "without rewriting the file.",
        },
        "type": {
            "type": "string",
            "enum": ["goal-and-requirements", "architecture-design",
                     "module-design", "submodule-design", "task-spec"],
            "description": "Spec type. Required for new specs, optional for updates.",
        },
        "id": {
            "type": "string",
            "description": "Explicit spec ID. If omitted, auto-generated from title.",
        },
        "title": {
            "type": "string",
            "description": "Override the registry title. If omitted, auto-derived "
                "from the first # heading in the content.",
        },
        "status": {
            "type": "string",
            "enum": ["draft", "active", "stale", "done", "deprecated"],
            "description": "Status to set. Defaults to 'draft' for new, unchanged for updates.",
        },
        "covers": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Source directories this spec covers (e.g. ['backend/app/foo/'])",
        },
        "tags": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Classification tags",
        },
    },
}
```

**Behavior:**

- If `path` matches an existing registry entry → **update**:
  - If `content` is provided: writes content to disk, updates timestamp, optionally updates status/covers/tags.
  - If `content` is omitted: reads current file from disk (no file write), re-derives title from the on-disk content, updates timestamp and any provided metadata (status/covers/tags). This is the **registry-sync** path — used after the agent edits a spec file via the Edit tool.
- If `path` is new → **create** (requires both `type` and `content`, creates file + entry, auto-generates ID/title if omitted).
- Title: if `title` is provided, it overrides the registry title directly. Otherwise, title is auto-derived from the first `# heading` in the content (whether provided or read from disk).
- Atomic: file write + registry update succeed together or not at all.

**Registry-sync workflow (the main use case for omitting content):**

```
Agent edits spec file via Edit tool
  → Agent calls spec_save(path="backend/app/foo/README.md", status="active")
  → spec_save reads file from disk, extracts title, syncs registry
  → Returns SpecDetail (no token cost for re-sending content)
```

**Returns:** JSON `SpecDetail` of the created/updated spec.

**Errors:** `isError: true` for invalid type, path conflicts, ID collisions, validation failures, missing content on create, file not found on disk when content omitted.

---

### spec_delete

Delete a spec file + registry entry + cleanup orphaned links.

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

**Returns:** Confirmation message.

**Errors:** `isError: true` if spec ID not found.

---

### spec_links

Get links for one or more spec IDs. Returns only the relationships involving the requested nodes — not the entire graph.

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
        "link_type": {
            "type": "string",
            "enum": ["parent", "depends-on", "references", "implements"],
            "description": "Filter to a specific link type (optional)",
        },
        "direction": {
            "type": "string",
            "enum": ["both", "outgoing", "incoming"],
            "description": "Filter link direction relative to the given IDs (default: 'both')",
        },
    },
}
```

**Behavior:**
- Returns all links where any of the given `ids` appears as `from` or `to` (or filtered by `direction`).
- `outgoing` = links where the ID is in `from`. `incoming` = links where the ID is in `to`.
- Optional `link_type` narrows to a single relationship kind (e.g., only `parent` links).

**Returns:** JSON `{ links: Link[], nodes: RegistryEntry[] }` — the matching links plus the summary entries for all referenced nodes (so the agent can resolve IDs to titles/types without a second call).

**Errors:** `isError: true` if any requested ID is not found in the registry.

---

### registry_query

Query registry entries with structured filters. More efficient than reading the full file.

```python
REGISTRY_QUERY_SCHEMA = {
    "type": "object",
    "properties": {
        "type": {
            "type": "string",
            "description": "Filter by spec type",
        },
        "status": {
            "type": "string",
            "description": "Filter by status",
        },
        "tag": {
            "type": "string",
            "description": "Filter entries that have this tag",
        },
        "covers": {
            "type": "string",
            "description": "Filter entries whose covers include this path prefix",
        },
        "ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Return only these specific IDs",
        },
        "include_links": {
            "type": "boolean",
            "description": "Include related links in response (default: false)",
        },
    },
}
```

**Returns:** JSON object `{ entries: RegistryEntry[], links?: Link[] }`.

---

### registry_mutate

Batch mutation of registry entries and links. All operations applied atomically with validation.

```python
REGISTRY_MUTATE_SCHEMA = {
    "type": "object",
    "properties": {
        "add_entries": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "type", "path", "title"],
                "properties": {
                    "id": {"type": "string"},
                    "type": {"type": "string"},
                    "path": {"type": "string"},
                    "title": {"type": "string"},
                    "status": {"type": "string"},
                    "covers": {"type": "array", "items": {"type": "string"}},
                    "tags": {"type": "array", "items": {"type": "string"}},
                },
            },
            "description": "New entries to add",
        },
        "update_entries": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id"],
                "properties": {
                    "id": {"type": "string", "description": "ID of entry to update"},
                    "status": {"type": "string"},
                    "title": {"type": "string"},
                    "tags": {"type": "array", "items": {"type": "string"}},
                    "covers": {"type": "array", "items": {"type": "string"}},
                },
            },
            "description": "Existing entries to update (only specified fields change)",
        },
        "remove_entries": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Entry IDs to remove (also removes their links)",
        },
        "add_links": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["from", "to", "type"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": ["parent", "depends-on", "references", "implements"],
                    },
                },
            },
            "description": "New links to add",
        },
        "remove_links": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["from", "to", "type"],
                "properties": {
                    "from": {"type": "string"},
                    "to": {"type": "string"},
                    "type": {"type": "string"},
                },
            },
            "description": "Links to remove (exact match on from+to+type)",
        },
    },
}
```

**Behavior:**
1. Read current registry.
2. Apply removals first (entries → their links auto-cleaned, then explicit link removals).
3. Apply additions (entries, then links).
4. Apply updates (merge only specified fields).
5. Validate final state: unique IDs, all link targets exist, recognized types.
6. Atomic write if validation passes. Return error if validation fails (no partial apply).

**Returns:** JSON `{ entries_added: int, entries_updated: int, entries_removed: int, links_added: int, links_removed: int }`.

**Errors:** `isError: true` with validation error details if final state is invalid.

---

## Interception & Permissions

All 7 tools are **auto-approved** with strict server-side validation. No tool suspends on a Future.

A single `intercept_specs()` function covers all 7 tools via the `INTERCEPTORS` registry (suffix-match routing in `permissions.py`). It returns `PermissionResultAllow` immediately — all validation happens inside the tool handlers.

In `bypassPermissions` (yolo) mode, the CLI skips `canUseTool` entirely, so the interceptor never fires. Tool handlers access `AppConfig` via `get_tool_context()` (set by `runner.py` before SDK client creation), so they work correctly regardless of permission mode.

Validation errors are returned as `isError: true` MCP responses, not permission denials — this avoids SDK error propagation issues (same pattern as SuggestSession's "never return PermissionResultDeny" rule).

### Draft Mode (ticket-specify sessions)

When a session has `skill_id == "ticket-specify"` AND `meta_ticket_id` is set, spec tools enter **draft mode**:

- **`spec_save`**: Instead of writing to disk via `SpecService`, redirects content to `.bonsai/spec-drafts/{ticket_id}/{path}` via `SpecDraftService.write_draft()`. The agent receives a response indicating the draft was saved. Registry is NOT modified.
- **`spec_get`**: Read-through semantics — checks the shadow directory first. If a draft exists for the requested spec, returns draft content overlaid on the real spec's metadata. Otherwise returns the real file as normal.
- **`spec_delete`**: Records a "delete" operation in the draft manifest via `SpecDraftService.record_delete()`. The real file is NOT deleted.

Draft mode is detected by `_is_draft_mode()` helper which checks `get_tool_context().task`. The `SpecDraftService` is accessed via `BoardService(config).spec_drafts`.

After the session, the user reviews diffs in the `TicketDraftsView` frontend component and applies/discards drafts selectively.

See also: `backend/app/board/spec_drafts.py` (SpecDraftService) and `docs/superpowers/specs/2026-04-03-spec-drafts-design.md`.

---

## Output Contract

### MCP_SERVERS addition

| Key | Server name | Tools exposed |
|-----|-------------|---------------|
| `"bonsai-specs"` | `bonsai-specs` | `spec_list`, `spec_get`, `spec_save`, `spec_delete`, `spec_links`, `registry_query`, `registry_mutate` |

### INTERCEPTORS addition

| Key (suffix match) | Behavior | Suspends? |
|---------------------|----------|-----------|
| `"spec_list"` | Auto-approve | No |
| `"spec_get"` | Auto-approve | No |
| `"spec_save"` | Auto-approve | No |
| `"spec_delete"` | Auto-approve | No |
| `"spec_links"` | Auto-approve | No |
| `"registry_query"` | Auto-approve | No |
| `"registry_mutate"` | Auto-approve | No |

> **Note:** Since all 7 tools share the same auto-approve intercept, an alternative is to register a single catch-all entry. However, per the parent spec's explicit registration pattern, each tool gets its own INTERCEPTORS key for clarity.

### Updated __init__.py

```python
from app.agent.tools.specs import specs_mcp_server, intercept_specs

MCP_SERVERS: dict[str, Any] = {
    "bonsai-vis": vis_mcp_server,
    "bonsai-proactive": suggest_session_mcp_server,
    "bonsai-specs": specs_mcp_server,
}

INTERCEPTORS: dict[str, InterceptFn] = {
    "bonsai_visualize": intercept_visualize,
    "SuggestSession": intercept_suggest_session,
    "spec_list": intercept_specs,
    "spec_get": intercept_specs,
    "spec_save": intercept_specs,
    "spec_delete": intercept_specs,
    "spec_links": intercept_specs,
    "registry_query": intercept_specs,
    "registry_mutate": intercept_specs,
}
```

---

## Data Flow

### Read path (spec_list, spec_get, spec_links, registry_query)

```
Agent calls tool
  → MCP handler receives args
  → Instantiate SpecService(config) or call registry functions
  → Filter/transform response
  → Return JSON as MCP text content
```

### Write path (spec_save with content, spec_delete, registry_mutate)

```
Agent calls tool
  → MCP handler receives args
  → Validate inputs (types, IDs, link targets)
  → Delegate to SpecService / registry functions
  → Service handles atomic file + registry write
  → Return success summary or isError with details
```

### Registry-sync path (spec_save without content)

```
Agent edits spec file via Edit tool
  → Agent calls spec_save(path=..., status=..., tags=...) — no content param
  → Handler detects existing entry + missing content
  → Reads file from disk via parser
  → Extracts title from first # heading
  → Updates registry entry (title, timestamp, metadata)
  → Atomic registry write (file is NOT rewritten)
  → Return SpecDetail with on-disk content
```

This path saves significant tokens when the agent has already modified the file via the Edit tool and just needs the registry to reflect the changes. The agent avoids re-reading the file and re-sending its full content.

### SpecService instantiation

The `AppConfig` is obtained from `get_tool_context().config` — set by `runner.py` via `set_tool_context()` before SDK client creation. This avoids global state and works in all permission modes:

```python
def _get_config():
    """Read AppConfig from tool context (set by runner)."""
    return get_tool_context().config

def _get_service() -> SpecService:
    return SpecService(_get_config())
```

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Single file** | All 7 tools in `specs.py` | Start simple, graduate per parent spec's rule. Tools are thin wrappers — no complex logic. |
| **Single MCP server** | `bonsai-specs` | Reduces registration overhead. Agent sees tools as a cohesive group. |
| **Auto-approve all** | No Future-based suspension | Agent needs autonomy for spec workflow. Validation catches errors without blocking. |
| **Validation, not denial** | Errors returned as `isError: true` responses | Follows SuggestSession precedent: never `PermissionResultDeny` to avoid SDK error propagation. |
| **Full batch for registry_mutate** | Single call handles entries + links | Creating a spec typically needs: add entry + add parent link + set covers. One call vs three. |
| **Apply removals before additions** | Delete → Add → Update order | Prevents transient conflicts (e.g., remove old entry then add replacement with same path). |
| **Config via contextvars** | Handler reads `get_tool_context().config` | Avoids global state. Works in all permission modes including yolo (where interceptors don't fire). Runner sets context once before SDK client creation. |
| **spec_save is create-or-update** | Upsert by path | Agent doesn't need to check existence first. Simplifies skill instructions. |
| **Content optional on updates** | `content` only required for creates; omit on updates to sync from disk | After using Edit tool on a spec file, the agent shouldn't need to re-read and re-send the full content (~2-20KB) just to sync the registry. Reading from disk is cheaper (0 agent tokens) and guarantees registry reflects actual file state. Alternatives rejected: metadata-only mode (adds cognitive load, risks registry-file drift), extending registry_mutate to parse frontmatter (breaks separation of concerns). |
| **Delegate to SpecService** | No new business logic | Reuses atomic writes, ID generation, validation. Single source of truth. |

---

## Known Limitations

- **No pagination** — `spec_list` and `registry_query` return all matching entries. Fine for current scale (~96 specs), may need pagination at 500+.
- **No content search** — Cannot grep within spec content via these tools. Agent still uses Grep tool for content-based search.
- **No file watcher integration** — External edits to `registry.json` are not detected. Tools always read from disk.
- **Single intercept function** — All 7 tools share one intercept. If a specific tool later needs interactive approval, this must be refactored.
- **Suffix collision** — Tool names like `spec_list` are short. If a future tool ends with the same suffix, `INTERCEPTORS` routing could conflict. Mitigated by explicit per-tool registration.
- **Disk-read on sync assumes valid Markdown** — When `content` is omitted in `spec_save`, the tool reads from disk and parses the file to extract the title. If the file has been partially written or contains invalid Markdown (e.g., mid-edit crash), the title extraction may fail or produce unexpected results. Mitigated by returning `isError: true` if parsing fails.

---

## Related Specs

- **Parent:** [Agent Tools](README.md)
- **Wraps:** [Spec Module](../../spec/README.md)
- **Sibling tools:** [Visualization](README.md#visualization), [SuggestSession](SUGGEST_SESSION.md)
- **Consumer skills:** All 14 skills in `claude-plugin/skills/`
- **Models:** [Spec Models](../../spec/models.py) — `SpecSummary`, `SpecDetail`, `SpecGraph`, `RegistryEntry`, `Link`