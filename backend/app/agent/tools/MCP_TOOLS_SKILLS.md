---
id: mcp-tools-skills
type: submodule-design
status: active
title: MCP Tools & Skill Instruction Changes
parent: frontmatter-registry
depends-on:
  - frontmatter-schema
  - index-concurrency
covers:
  - backend/app/agent/tools/specs.py
  - backend/app/agent/tools/__init__.py
tags:
  - backend
  - agent-orchestration
  - mcp-tools
  - skills
---
# MCP Tools & Skill Instruction Changes

> Status: **Active** | Created: 2026-04-27 | Parent: [FRONTMATTER_REGISTRY_DESIGN.md](../../../../.bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md)

Defines the 3 custom MCP tools that replace the original 7, and the patterns for updating all 18 skill instruction files.

---

## MCP Tools Redesign

The current 7 MCP tools (`spec_list`, `spec_get`, `spec_save`, `spec_delete`, `spec_links`, `registry_query`, `registry_mutate`) are replaced with **3 custom tools**. Agents use standard `Write`/`Edit`/`Read` tools for file operations — custom tools only provide what standard tools cannot.

### Design Principle

**Custom tools exist only for operations standard file tools cannot do.** Agents already have `Read`, `Write`, `Edit`, and `Glob`. The only things those can't do are: querying the SQLite index and performing multi-file cleanup on delete.

### Tool: `spec_search`

**Purpose:** Discover specs the agent doesn't already know about.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | string | no | Filter by spec type |
| `status` | string | no | Filter by lifecycle status |
| `tag` | string | no | Filter by tag (exact match) |
| `covers` | string | no | Filter by covered source path prefix |

**Returns:** List of `{id, path, title, type, status, tags}` — enough for the agent to then `Read` the file if needed.

**Replaces:** `spec_list` + `registry_query` (merged into one focused search tool)

### Tool: `spec_links`

**Purpose:** Navigate relationships from a known spec via the SQLite index.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ids` | list[string] | yes | Spec IDs to query |
| `direction` | string | no | `children`, `parents`, `dependencies`, `dependents`, `all` (default: `all`) |
| `link_type` | string | no | Filter to specific link type |

**Returns:** Related specs with link type + their summaries `{id, path, title, type, status}`.

**Replaces:** `spec_links` (same name, simplified params)

### Tool: `spec_delete`

**Purpose:** Delete a spec with multi-file cleanup.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Spec ID to delete |

**Cleanup steps:**
1. Emit `SpecDeleteRequested` event to the IndexCoordinator
2. Coordinator moves file to `.bonsai/trash/` (soft-delete, restorable)
3. Find all other specs whose frontmatter references this ID → edit their frontmatter to remove dangling refs
4. Watcher re-indexes all changed files via coordinator
5. Push notifications: `spec/didDelete` + `spec/didUpdate` for cleaned specs

`spec_delete` is the only agent tool that performs write operations. It routes through the IndexCoordinator to ensure serialization with all other index mutations.

**Replaces:** `spec_delete` (same name, added cross-file cleanup + coordinator routing)

### Removed Tools

| Old Tool | Replacement | Rationale |
|----------|-------------|-----------|
| `spec_list` | `spec_search` | Merged with `registry_query` |
| `spec_get` | Standard `Read` tool | Agent knows the path from `spec_search`, reads the file directly |
| `spec_save` | Standard `Write`/`Edit` tools | Agent writes frontmatter + content directly. Watcher validates and indexes. |
| `registry_query` | `spec_search` | Same capability, better name |
| `registry_mutate` | Standard `Edit` tool + `spec_delete` | Links live in frontmatter — agent edits files directly. |

### Tool Registration

```python
MCP_SERVERS: dict[str, Any] = {
    "bonsai-specs": specs_mcp_server,  # spec_search, spec_links, spec_delete
}

INTERCEPTORS: dict[str, InterceptFn] = {
    "spec_search": intercept_specs,    # auto-approved
    "spec_links": intercept_specs,     # auto-approved
    "spec_delete": intercept_specs,    # auto-approved
}
```

---

## Skill Instruction Changes

All 18 skills in `claude-plugin/skills/*/SKILL.md` must be updated. The changes fall into patterns:

### Pattern 1: Read-Only Skills (query index, display results)

**Skills:** `spec-status`, `spec-next`, `cli-progress`, `visualization`

**Change:** Replace `spec_list`/`registry_query` calls with `spec_search`. Replace `spec_get` with `Read` tool.

### Pattern 2: Spec-Creating Skills (create new spec + link it)

**Skills:** `architecture-design`, `module-design`, `submodule-design`, `task-spec`, `goal-and-requirements`, `spec-init`, `spec-from-code`

**Change:** Replace `spec_save` + `registry_mutate` with `Write` tool (agent writes full file with frontmatter).

### Pattern 3: Spec-Modifying Skills (update status, fix links)

**Skills:** `spec-review`, `spec-lint`

**Change:** Replace `registry_mutate` status/link updates with `Edit` tool (edit frontmatter in-place).

### Pattern 4: Ticket Skills (draft mode)

**Skills:** `ticket-specify`, `ticket-describe`, `ticket-plan`, `ticket-execute`

**Change:** Draft mode may need redesign — currently `spec_save` redirects to a shadow directory. In the new model, the agent writes files directly.

### Frontmatter Schema

The frontmatter field reference (required fields, optional fields, YAML example) is in the **General Instructions** section of the system prompt — always available in every session. Skills no longer include their own copy.

Skills retain **Registry Integration** sections with type-specific linking guidance (e.g., module-design: "set parent to architecture doc").
