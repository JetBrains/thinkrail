# Implement Spec models.py

> Pydantic data models for the spec domain

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Spec reference:** `backend/app/spec/README.md`

## Files to Modify

- `backend/app/spec/models.py`

## Summary

The Spec module is the core domain layer of Bonsai. `models.py` defines all data structures used across the module — every other spec file imports from here. This is the foundational dependency with no internal module dependencies.

## Models

### Spec
| Field | Type | Description |
|-------|------|-------------|
| `type` | `str` | Spec type (e.g. "module-design", "task-spec") |
| `content` | `str` | Raw file content |
| `metadata` | `dict \| None` | Parsed JSON object for JSON specs; None for Markdown |

### RegistryEntry
| Field | Type | Description |
|-------|------|-------------|
| `id` | `str` | Unique identifier |
| `type` | `str` | Spec type |
| `path` | `str` | Relative path from project root |
| `title` | `str` | Human-readable title |
| `status` | `str` | e.g. "active", "draft", "archived" |
| `covers` | `list[str]` | File/directory patterns this spec covers |
| `tags` | `list[str]` | Classification tags |
| `created` | `str` | ISO date string |
| `updated` | `str` | ISO date string |

### Link
| Field | Type | Description |
|-------|------|-------------|
| `from_id` | `str` | Source spec ID (serializes to "from" via Pydantic alias) |
| `to_id` | `str` | Target spec ID (serializes to "to" via Pydantic alias) |
| `type` | `str` | Relationship type (e.g. "depends-on", "parent", "implements") |

> **Note:** Use `Field(alias="from")` / `Field(alias="to")` since "from" is a reserved keyword.

### SpecSummary
- `id`, `type`, `path`, `status`, `title`, `tags`
- Lightweight listing model for `list_specs()`

### SpecDetail
- `id`, `type`, `path`, `status`, `title`, `tags`, `content`, `links: list[Link]`
- Full spec with content for `get_spec()`

### SpecGraph
- `nodes: list[RegistryEntry]`, `edges: list[Link]`
- Complete hierarchy for `get_graph()`

## Plan

1. Create `backend/app/spec/__init__.py` with public model exports
2. Define `Spec` model with type, content, metadata fields
3. Define `RegistryEntry` with all registry fields + validation
4. Define `Link` with from/to aliases for JSON serialization
5. Define `SpecSummary` and `SpecDetail` (can derive from RegistryEntry or standalone)
6. Define `SpecGraph` as container for nodes + edges
7. Write unit tests: model creation, validation, JSON serialization (especially Link aliases)

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/spec/models.py` | Create | All Pydantic models |
| `backend/app/spec/__init__.py` | Create | Module exports |
| `tests/spec/test_models.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
