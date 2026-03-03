# Implement Spec service.py

> Facade for all spec CRUD operations

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Depends on:** `feature_spec_models`, `feature_spec_parser`, `feature_spec_validator`, `feature_spec_registry`, `feature_spec_graph`
**Spec reference:** `backend/app/spec/README.md`

## Files to Modify

- `backend/app/spec/service.py`

## Summary

`service.py` is the single entry point for all spec operations. It is called from RPC methods (user CRUD) and watcher callbacks (disk change detection). It delegates to parser, validator, graph, and registry — no direct file or registry access happens outside this facade.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `list_specs` | `() → list[SpecSummary]` | Read registry, return lightweight summaries. May return empty list. |
| `get_spec` | `(id: str) → SpecDetail` | Lookup entry, parse file, assemble SpecDetail with links. Raises `SpecNotFoundError`. |
| `create_spec` | `(type: str, path: str, content: str \| None = None) → SpecDetail` | Create spec file on disk + add registry entry. |
| `update_spec` | `(id: str, content: str) → SpecDetail` | Update spec file content on disk + update registry entry. |
| `delete_spec` | `(id: str) → None` | Remove spec file from disk + remove registry entry. |
| `get_graph` | `() → SpecGraph` | Read registry, build and return full hierarchy graph. |

### Details

- **create_spec:** Title is auto-derived from first heading in content (or from path if no content). ID is generated (slug from path or title). Status defaults to "draft". Raises on path conflict or invalid type.
- **update_spec:** Updates `updated` timestamp. Raises `SpecNotFoundError` or validation failure.
- **delete_spec:** Raises `SpecNotFoundError` if not found.

### Dependencies

- `spec/parser.py` (parse_spec)
- `spec/validator.py` (validate_spec, validate_links)
- `spec/graph.py` (build_graph)
- `spec/registry.py` (read_registry, write_registry, find_entry, add_entry, remove_entry)
- `core/config` (get_project_root, get_spec_dir, get_registry_path)
- `core/fileio` (write_text, delete_file, ensure_dir)

## Plan

1. Implement `list_specs` — read registry → map entries to SpecSummary
2. Implement `get_spec` — find entry → parse file → assemble SpecDetail with filtered links
3. Implement `create_spec` — validate → write file → add registry entry → write registry
4. Implement `update_spec` — find entry → validate → write file → update registry
5. Implement `delete_spec` — find entry → delete file → remove entry → write registry
6. Implement `get_graph` — read registry → build_graph
7. Add ID generation helper (slugify from path or title)
8. Add title extraction helper (first Markdown heading or filename)
9. Write unit tests with mocked dependencies for all 6 methods + error cases

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/spec/service.py` | Create | Service facade |
| `backend/app/spec/__init__.py` | Update | Add service exports |
| `tests/spec/test_service.py` | Create | Unit tests with mocks |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
