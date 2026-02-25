# Spec Module — Design Specification

> Parent: [DESIGN_DOC.md](../../../DESIGN_DOC.md) | Status: **Active** | Created: 2026-02-25

## Purpose

The Spec module is the core domain layer of Bonsai. It owns all spec file operations — parsing Markdown specs from disk, validating their structure, managing the registry (`.specs/registry.json`), and building the hierarchy graph that maps parent-child and cross-reference relationships. All spec CRUD flows through this module's service layer, which is the single source of truth for spec state.

## Internal Architecture

**Pattern:** Service-centric (facade)

`service.py` is the single entry point for all spec operations. It is called from two directions:
1. **RPC methods** — user-initiated CRUD via JSON-RPC (`spec/create`, `spec/update`, etc.)
2. **Watcher callback** — automatic, when any spec file changes on disk (from any source: user, agent, external tool). The callback is registered by `rpc/server.py`, which calls `spec/service` to validate and postprocess, then pushes notifications to the frontend.

Both paths use the same service methods — there is no special case handling per caller.

```
  ┌─────────────────────┐    ┌─────────────────────────────────┐
  │  RPC methods        │    │  rpc/server.py watcher callback │
  │  (user CRUD)        │    │  (any spec file change on disk) │
  └──────────┬──────────┘    └──────────────┬──────────────────┘
             │                              │
             └──────────────┬───────────────┘
                            ▼
            ┌───────────────────────────────┐
            │  service.py  (facade)         │
            └───┬───────────┬───────────────┘
                │           │           │
      ┌─────────┘           │    └──────┘
      ▼                     ▼           ▼
  ┌────────┐  ┌──────────┐  ┌────────┐  ┌──────────┐
  │parser  │  │validator │  │ graph  │  │registry  │
  └────────┘  └──────────┘  └────────┘  └──────────┘
      ▲             ▲             ▲            ▲
      └─────────────┴─────────────┴────────────┘
                            │
              ┌─────────────┴──────────────┐
              │         models.py          │
              │  Spec, RegistryEntry, etc. │
              └────────────────────────────┘
```

## File Organization

| File | Responsibility | Depends On |
|------|---------------|------------|
| `models.py` | Pydantic models: Spec, RegistryEntry, Link, SpecGraph, SpecSummary, SpecDetail | — |
| `service.py` | Facade — all CRUD operations, delegates to other components | parser, validator, graph, registry, core/config |
| `parser.py` | Parse Markdown spec files (frontmatter + content) | models, core/fileio |
| `validator.py` | Validate spec structure, required fields, link integrity | models |
| `graph.py` | Build in-memory hierarchy graph from registry entries + links | models |
| `registry.py` | Read/write/validate `.specs/registry.json` — atomic writes, schema validation | models, core/fileio |

## Public Interface

### Service Layer (called by RPC methods)

| Method | Signature | Description |
|--------|-----------|-------------|
| `list_specs` | `() → list[SpecSummary]` | List all specs with metadata from registry |
| `get_spec` | `(id: str) → SpecDetail` | Get full spec content + metadata |
| `create_spec` | `(type: str, path: str, content: str?) → SpecDetail` | Create spec file + registry entry |
| `update_spec` | `(id: str, content: str) → SpecDetail` | Update spec content on disk + registry |
| `delete_spec` | `(id: str) → None` | Remove spec file + registry entry |
| `get_graph` | `() → SpecGraph` | Return full hierarchy graph (nodes + edges) |

### Models

| Model | Fields | Description |
|-------|--------|-------------|
| `Spec` | type, content, frontmatter (dict) | Parsed spec from disk |
| `RegistryEntry` | id, type, path, title, status, covers, tags, created, updated | Single entry in registry.json |
| `Link` | from_id, to_id, type | Relationship between specs |
| `SpecSummary` | id, type, path, status, title, tags | Lightweight listing model |
| `SpecDetail` | id, type, path, status, title, tags, content, links | Full spec with content |
| `SpecGraph` | nodes: list[RegistryEntry], edges: list[Link] | Complete hierarchy |

### Output Contracts

| Method | Returns | Error Cases |
|--------|---------|-------------|
| `list_specs` | `list[SpecSummary]` (may be empty) | Registry file missing or malformed |
| `get_spec` | `SpecDetail` | Spec not found, file missing on disk |
| `create_spec` | `SpecDetail` | Path conflict, invalid type |
| `update_spec` | `SpecDetail` | Spec not found, validation failure |
| `delete_spec` | `None` | Spec not found |
| `get_graph` | `SpecGraph` | Registry malformed |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Registry storage | Single JSON file (`.specs/registry.json`) | Simplicity — easy to implement, debug, and version control as one atomic file |
| Spec format | Markdown with YAML frontmatter | Simplicity — human-readable, git-friendly, widely supported by editors and tools |
| Graph storage | In-memory, rebuilt on changes | Simplicity — no persistence layer to maintain, graph is derived from registry which is the source of truth |
| Internal pattern | Service facade | Simplicity — single entry point makes the module easy to test and reason about |

## Dependencies

| Dependency | Usage |
|------------|-------|
| `core/config` | Project root path, spec directory config |
| `core/fileio` | File read/write/delete for spec files and registry |
| `pydantic` | Model validation and serialization |

## Known Limitations

- **Incomplete feature support:** Spec diffing, merge conflict resolution, and bulk operations (move, rename with link updates) are not yet designed. Some spec types may need additional parsing logic as the format evolves.
- **Performance bottlenecks:** Single JSON registry file may become slow for projects with hundreds of specs. The in-memory graph rebuild on every change does not scale to very large spec trees. No caching layer is planned for v1.

## Sub-modules

None currently — all files are at the module level. As complexity grows, `parser.py` or `graph.py` may warrant sub-module extraction.

## Related Specs

- **Parent:** [Architecture Design](../../../DESIGN_DOC.md)
- **Depends on:** [Goal & Requirements](../../../GOAL&REQUIREMENTS.md)
- **Related modules:** `rpc/methods/specs.py` (JSON-RPC interface to this module)
