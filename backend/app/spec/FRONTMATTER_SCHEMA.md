---
id: frontmatter-schema
type: submodule-design
status: active
title: Frontmatter Schema & Data Flows
parent: frontmatter-registry
covers:
  - backend/app/spec/frontmatter.py
  - backend/app/spec/models.py
  - backend/app/spec/service.py
tags:
  - backend
  - spec-format
  - data-model
---
# Frontmatter Schema & Data Flows

> Status: **Active** | Created: 2026-04-27 | Parent: [FRONTMATTER_REGISTRY_DESIGN.md](../../../.bonsai/design_docs/FRONTMATTER_REGISTRY_DESIGN.md)

Defines the YAML frontmatter format for spec files, file discovery and classification rules, read/write flows, and unmanaged document support.

---

## Frontmatter Schema

Spec files use YAML frontmatter (delimited by `---`) at the top of the file.

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique spec identifier (e.g. `module-spec`, `task-fix-auth`). Must be unique across the project. |
| `type` | string | Spec type. One of: `goal-and-requirements`, `architecture-design`, `module-design`, `submodule-design`, `task-spec` |

### Optional Fields (with defaults)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | `"draft"` | Lifecycle state: `draft`, `active`, `stale`, `done`, `deprecated` |
| `title` | string | First `# ` heading or filename | Human-readable display name |
| `parent` | string | — | Spec ID of the parent in the hierarchy |
| `depends-on` | list[string] | `[]` | Spec IDs this spec depends on |
| `references` | list[string] | `[]` | Spec IDs this spec references |
| `implements` | list[string] | `[]` | Spec IDs this spec implements |
| `covers` | list[string] | `[]` | Source paths this spec documents (for coverage tracking) |
| `tags` | list[string] | `[]` | Classification labels |

### Custom Fields

Any additional key-value pairs in the frontmatter are preserved in the index (`extras` JSON column) and passed through to API responses. This allows project-specific metadata without schema changes.

### Example Spec File

```markdown
---
id: module-spec
type: module-design
status: active
parent: design-doc
depends-on:
  - goal-and-requirements
covers:
  - backend/app/spec/
tags:
  - backend
  - core-domain
priority: high          # custom field — preserved in extras
---

# Spec Module — Design Specification

The Spec module is the core domain layer of Bonsai...
```

### Link Fields → Link Table Mapping

Frontmatter link fields are directional — they express outgoing relationships from the spec that contains them:

| Frontmatter Field | Link Type | Direction |
|-------------------|-----------|-----------|
| `parent: X` | `parent` | this spec → X |
| `depends-on: [X, Y]` | `depends-on` | this spec → X, this spec → Y |
| `references: [X]` | `references` | this spec → X |
| `implements: [X]` | `implements` | this spec → X |

The index resolves bidirectional views (e.g., "which specs depend on me?") via SQL queries on the `links` table.

---

## File Discovery & Classification

The indexer scans all `.md` files in the project (respecting `.bonsaihide` rules) and classifies each:

```
.md file found
    │
    ├── Has YAML frontmatter with `id` + `type`?
    │       YES → Managed Spec → upsert into `specs` + `links` tables
    │
    ├── Has YAML frontmatter but missing `id` or `type`?
    │       → Warning logged, treated as unmanaged document
    │
    └── No frontmatter?
            → Unmanaged Document → upsert into `documents` table
              (title extracted from first # heading or filename)
```

### Scan Directories

By default, the indexer scans from the project root. Files matched by `.bonsaihide` patterns are excluded (consistent with existing file listing behavior).

### Promoting Unmanaged → Managed

A user or agent can "promote" an unmanaged document to a managed spec by adding valid frontmatter (`id` + `type`). The watcher detects the change, re-parses, and moves the entry from `documents` to `specs`.

---

## Write Flow

All spec mutations follow the same path — **write the file first, the index follows**:

1. **Agent / User / MCP tool** calls `SpecService.create_spec()` or `SpecService.update_spec()`
2. **Service** writes the `.md` file with frontmatter to disk
3. **File watcher** detects the change, emits a `FileChanged` event to the **IndexCoordinator**
4. **Coordinator** (single consumer) calls `reindex_file()` — frontmatter parser reads the file, extracts metadata
5. **Indexer** upserts the `specs` row and replaces `links` rows (delete old + insert new), commits
6. **Coordinator** pushes notification to frontend (`spec/didCreate`, `spec/didChange`)

For spec deletion, the MCP `spec_delete` tool emits a `SpecDeleteRequested` event to the coordinator, which handles file removal, cross-file cleanup, and index updates — all serialized with other mutations.

All index writes flow through the coordinator's event queue, ensuring no concurrent writes to the SQLite database. See [INDEX_CONCURRENCY.md](./INDEX_CONCURRENCY.md) for details.

### Frontmatter Serialization

When writing a spec, the service must serialize metadata into YAML frontmatter at the top of the file. The service:

1. Builds the frontmatter dict from method arguments (id, type, status, links, etc.)
2. Serializes to YAML between `---` delimiters
3. Appends the Markdown content body
4. Writes atomically (temp file → rename)

When updating only metadata (e.g., changing status), the service:

1. Reads the existing file
2. Parses frontmatter + body
3. Merges new fields into frontmatter
4. Rewrites the file with updated frontmatter + unchanged body

---

## Read Flow

All reads go through the SQLite index for performance:

1. **`list_specs()`** → `SELECT * FROM specs` with optional `WHERE` filters
2. **`get_spec(id)`** → `SELECT` from `specs` + `SELECT` from `links` + read file content from disk
3. **`get_graph()`** → `SELECT * FROM specs` + `SELECT * FROM links` + `SELECT * FROM documents` → return as `SpecGraph`
4. **Search by tag/covers** → SQL `WHERE` with `json_each()` for JSON array fields

File content is always read from disk (not cached in SQLite) — the index stores only metadata.

---

## Unmanaged Documents Support

Plain Markdown files without valid frontmatter are auto-discovered during indexing and stored in the `documents` table.

### Principles

- **Documents are proto-specs** — they travel in the same `SpecGraph` response because they represent documentation that may eventually be promoted.
- **Separate type** — a dedicated `DocumentEntry` model (not a fake `SpecEntry`) preserves the managed/unmanaged boundary.
- **Minimal notification** — a single `docs/didChange` event triggers a graph re-fetch.
- **Visual separation** — the SpecTree renders documents in a collapsible section below managed specs.
- **Noise filtering** — `.bonsai/` infrastructure dirs (trash, cache, sessions, plans) are excluded at index time via built-in skip paths. Project-specific noise is handled by `.bonsaihide`.

### Data Model

**Backend** — new `DocumentEntry` in `models.py`, and extended `SpecGraph`:

```python
class DocumentEntry(BaseModel):
    """A row in the SQLite documents table — an unmanaged .md file."""
    path: str   # relative to project root
    title: str  # from first # heading or filename

class SpecGraph(BaseModel):
    nodes: list[SpecEntry] = Field(default_factory=list)
    edges: list[Link] = Field(default_factory=list)
    documents: list[DocumentEntry] = Field(default_factory=list)  # NEW
```

**Frontend types** in `frontend/src/types/spec.ts` are hand-written (not codegen'd) and must be updated manually to mirror the backend models.

### Index-time Filtering

`_find_md_files()` applies a fourth exclusion layer — a constant set of `.bonsai/` internal paths that are never meaningful as unmanaged docs:

- `.bonsai/trash`, `.bonsai/cache`, `.bonsai/sessions`, `.bonsai/plans`, `.bonsai/design_docs/plans`

This is an explicit list (not a wildcard). New `.bonsai/` subdirs that produce `.md` files require manual addition.

### SpecTree Rendering

Two-section layout:

1. **Managed specs** (existing) — hierarchical tree from `buildTree(graph.nodes)`
2. **Unmanaged documents** — collapsible file tree from `buildDocTree(graph.documents)`

The section header reads `📄 Unmanaged Documents ({count})`, collapsed by default. Documents render as a file tree with directory grouping and path collapsing. Click opens file in preview pane; no status badges.

### Promotion Flow

When a user adds valid frontmatter to an unmanaged document, the watcher re-classifies it: the entry moves from `documents` to `specs`, emitting both `spec/didCreate` and `docs/didChange`.
