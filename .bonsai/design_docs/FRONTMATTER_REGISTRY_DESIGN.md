---
id: frontmatter-registry
type: architecture-design
status: active
title: Frontmatter + SQLite Index — Architecture
parent: design-doc
references:
- module-spec
- goal-and-requirements
- frontmatter-schema
- index-concurrency
- mcp-tools-skills
covers:
- backend/app/spec/
tags:
- architecture
- spec-format
- registry
- migration
---
# Frontmatter + SQLite Index — Architecture

> Status: **Active** | Created: 2026-04-16 | Parent: [DESIGN_DOC.md](../../DESIGN_DOC.md)

## Table of Contents
1. [Overview](#overview)
2. [Motivation](#motivation)
3. [Architecture](#architecture)
4. [Submodule Specifications](#submodule-specifications)
5. [Migration Strategy](#migration-strategy)
6. [Impact on Existing Code](#impact-on-existing-code)
7. [Design Decisions](#design-decisions)

---

## Overview

Replace the single `registry.json` file with a two-layer architecture:

1. **YAML frontmatter** in each spec file — the **sole source of truth** for all spec metadata (id, type, status, links, tags, etc.)
2. **Per-project SQLite database** (`~/.bonsai/indexes/<project-hash>/index.db`) — a **generated cache** rebuilt from frontmatter, stored in the server data directory (completely outside the project repo), used for fast queries and graph traversal. Never hand-edited.

Plain Markdown files without frontmatter are auto-discovered as "unmanaged" documents — visible in the graph as grey nodes, promotable to managed specs by adding frontmatter.

## Motivation

The current `registry.json` architecture has several pain points:

| Problem | Impact |
|---------|--------|
| **Git merge conflicts** | Any two spec changes in parallel branches cause merge conflicts in the single registry file |
| **Scalability** | Registry grows unbounded (~4K lines), full rewrite on every change |
| **Coupling** | Spec files are "dumb" — moving/renaming requires a registry update |
| **Discoverability** | Cannot understand a spec by reading the file alone — must cross-reference registry |
| **Fragility** | Single point of failure — corrupt registry = all metadata lost |

## Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Spec Files (.md)                                           │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐  │
│  │ module-spec.md  │  │ task-fix.md     │  │ notes.md   │  │
│  │ ---             │  │ ---             │  │ (no front- │  │
│  │ id: module-spec │  │ id: task-fix    │  │  matter)   │  │
│  │ type: module    │  │ type: task-spec │  │            │  │
│  │ parent: design  │  │ depends-on:     │  │            │  │
│  │ ---             │  │   - module-spec │  │            │  │
│  │ # Content...    │  │ ---             │  │ # Notes... │  │
│  └────────┬────────┘  └────────┬────────┘  └─────┬──────┘  │
│           │                    │                  │          │
└───────────┼────────────────────┼──────────────────┼──────────┘
            │                    │                  │
            ▼                    ▼                  ▼
     ┌──────────────────────────────────────────────────┐
     │  File Watcher → IndexCoordinator                 │
     │  (events serialized, async I/O, debounced)       │
     └──────────────────────┬───────────────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────────────┐
     │  ~/.bonsai/indexes/<hash>/index.db  (SQLite)     │
     │  ┌─────────┐ ┌───────┐ ┌───────────┐ ┌───────┐  │
     │  │  specs  │ │ links │ │ documents │ │ _meta │  │
     │  └─────────┘ └───────┘ └───────────┘ └───────┘  │
     └──────────────────────┬───────────────────────────┘
                            │
                            ▼
     ┌──────────────────────────────────────────────────┐
     │  RPC / MCP Tools → Frontend                      │
     └──────────────────────────────────────────────────┘
```

### Design Principles

1. **Frontmatter is the only source of truth** — The SQLite index can always be deleted and rebuilt by scanning spec files. The database is a performance optimization, not a data store.
2. **Zero-config discovery** — Drop a `.md` file with valid frontmatter anywhere in the project and it is automatically indexed. No manual registration step.
3. **Graceful degradation** — If `index.db` is missing or corrupt, the system transparently rebuilds it from frontmatter. The user is never blocked.
4. **Index lives outside the repo** — The SQLite index is stored in the server data directory (`~/.bonsai/`), never inside the project. This eliminates `.gitignore` concerns and keeps the repo clean.
5. **Single writer** — All index mutations are serialized through the IndexCoordinator. No concurrent writes, no locks needed.

### Index Location Resolution

The index database is stored outside the project repository, in the server data directory alongside `bonsai.db`. Each project gets its own subdirectory keyed by a truncated SHA-256 hash of the project's absolute path:

```
~/.bonsai/                          # server data dir (BONSAI_DATA_DIR override)
  bonsai.db                         # server-wide DB (users, tokens, projects)
  indexes/
    a1b2c3d4e5f6g7h8/              # SHA-256(project_root)[:16]
      index.db                      # spec index for project at /home/user/myproject
      index.db-wal                  # WAL file (SQLite)
```

**Why this pattern:**
- **VS Code** uses the same approach (`workspaceStorage/<md5>/state.vscdb`)
- **Bazel** uses a similar scheme (`~/.cache/bazel/_bazel_$USER/<md5>/`)
- 16 hex characters provide 2^64 possible hashes — collision probability is negligible
- Reuses the existing `get_data_dir()` infrastructure and `BONSAI_DATA_DIR` override

---

## Submodule Specifications

This architecture is decomposed into three submodule design specs:

| Submodule | Spec ID | Covers |
|-----------|---------|--------|
| [Frontmatter Schema & Data Flows](../../backend/app/spec/FRONTMATTER_SCHEMA.md) | `frontmatter-schema` | Frontmatter format, file discovery, read/write flows, unmanaged documents |
| [SQLite Index & Concurrency Model](../../backend/app/spec/INDEX_CONCURRENCY.md) | `index-concurrency` | SQLite schema, rebuild/recovery, IndexCoordinator, async I/O, watcher validation |
| [MCP Tools & Skill Instructions](../../backend/app/agent/tools/MCP_TOOLS_SKILLS.md) | `mcp-tools-skills` | 3 custom MCP tools, 18 skill instruction update patterns |

---

## Migration Strategy

### From `registry.json` to Frontmatter

One-time migration tool (`bonsai migrate-registry` or automatic on first startup):

1. **Read** `registry.json` — parse all entries and links
2. **For each entry:**
   a. Read the spec file at `entry.path`
   b. Build frontmatter dict: `{id, type, status, covers, tags}` from registry entry
   c. Add link fields: scan `links` array for this spec's outgoing links → add `parent`, `depends-on`, etc.
   d. Inject frontmatter at the top of the file (before existing content)
   e. Write updated file
3. **Build index.db** in the server data directory from the newly-frontmatted files
4. **Archive** `registry.json` → `.bonsai/registry.json.bak` (keep for safety)

### Rollback

If migration fails partway:
- `registry.json.bak` is untouched
- Files that were already updated have frontmatter (harmless — old system ignores it)
- Re-run migration to complete remaining files

---

## Impact on Existing Code

### Files to Modify

| File | Change |
|------|--------|
| `backend/app/spec/models.py` | Add frontmatter-related models; add `DocumentEntry` model; extend `SpecGraph` with `documents` field |
| `backend/app/spec/registry.py` | **Replace** — becomes `index.py` (SQLite read/write/rebuild) |
| `backend/app/spec/parser.py` | **Extend** — add YAML frontmatter parsing |
| `backend/app/spec/service.py` | Update to write frontmatter into files, query SQLite for reads |
| `backend/app/spec/validator.py` | Validate frontmatter fields instead of registry entries |
| `backend/app/spec/index.py` | `_ready` → `asyncio.Event`; transactional rebuild; async I/O via `aiofiles` |
| `backend/app/agent/tools/specs.py` | **Rewrite** — 7 tools → 3 tools; `spec_delete` routes through coordinator |
| `backend/app/agent/tools/__init__.py` | Update `MCP_SERVERS` and `INTERCEPTORS` |
| `backend/app/rpc/server.py` | Watcher emits events to IndexCoordinator; `_rebuild_on_bonsaihide()` removed |
| `backend/app/core/config.py` | Add `get_index_path(project_root)` |
| `backend/app/spec/graph.py` | Pass documents through to `SpecGraph` |
| `frontend/src/store/specStore.ts` | Handle `docs/didChange` notification |
| `frontend/src/components/SpecTree/` | Add collapsible unmanaged documents section |
| `claude-plugin/skills/*/SKILL.md` | **All 18 skills** — update tool references |

### New Files

| File | Purpose |
|------|---------|
| `backend/app/spec/index.py` | SQLite index management |
| `backend/app/spec/coordinator.py` | IndexCoordinator — event bus for serialized index mutations |
| `backend/app/spec/frontmatter.py` | YAML frontmatter parsing and serialization |

### Files to Remove

| File | Reason |
|------|--------|
| `backend/app/spec/registry.py` | Replaced by `index.py` |
| `.bonsai/registry.json` | Replaced by frontmatter + index.db (archived as `.bak`) |

### API Compatibility

The RPC method interfaces remain unchanged — only the internal implementation changes. Frontend code should not need updates beyond handling new notifications.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Metadata location | YAML frontmatter in each spec file | Self-contained, git-friendly, eliminates merge conflicts. |
| Index storage | Per-project SQLite in server data dir | Outside the repo — no `.gitignore` needed. VS Code / Bazel pattern. |
| Index persistence | Outside repo, rebuilt from frontmatter | Frontmatter is source of truth. Index is a cache — deletable, rebuildable. |
| Unmanaged files | Auto-discovered, in `SpecGraph.documents` | Zero friction. Dedicated `DocumentEntry` model. Promote by adding frontmatter. |
| Link storage | In frontmatter (outgoing direction) | Co-located with content. Bidirectional views via SQL queries. |
| Dangling links | Allowed (to_id not FK) | Specs may reference future specs. Validation warns but doesn't block. |
| Custom fields | Preserved in `extras` JSON column | Extensible without schema changes. |
| Write flow | File first, index follows via watcher | Single pipeline for all change sources. Frontmatter is authoritative. |
| Required fields | `id` + `type` only | Lowest friction. Everything else has sensible defaults. |
| MCP tools | 3 custom tools only | Custom tools only for what standard file tools can't do. |
| Spec creation | Agents write files directly with frontmatter | Skills teach the format, watcher validates. |
| Concurrency model | IndexCoordinator — single-consumer `asyncio.Queue` | Structural serialization, no locks. Debounce, drain, FIFO ordering. |
| Rebuild atomicity | Single SQLite transaction | WAL readers see pre-rebuild data until commit. No partial state. |
| Async file I/O | `aiofiles` + `asyncio.to_thread()` | Prevents event-loop blocking. Single new dependency. |
| Readiness signaling | `asyncio.Event` | Properly awaitable. Non-blocking `is_set()` for backward compat. |
| Cold-start catchup | Background differential scan | Serves existing data immediately. Hash comparison finds offline edits. Purges index entries for files deleted while server was down. |
