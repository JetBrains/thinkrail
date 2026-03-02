# Implement Spec registry.py

> Read/write/validate `.specs/registry.json`

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Depends on:** `feature_spec_models`, `feature_core_fileio`
**Spec reference:** `backend/app/spec/README.md`

## Summary

`registry.py` manages the `.specs/registry.json` file — the single source of truth for all spec metadata and relationships. It provides atomic writes to prevent corruption and schema validation on read to catch manual edit errors.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `read_registry` | `(path: Path) → tuple[list[RegistryEntry], list[Link]]` | Read and parse registry.json. Returns entries and links. |
| `write_registry` | `(path: Path, entries: list[RegistryEntry], links: list[Link]) → None` | Write registry.json atomically (write to temp file, then rename). |
| `find_entry` | `(entries: list[RegistryEntry], id: str) → RegistryEntry \| None` | Lookup a single entry by ID. |
| `add_entry` | `(entries: list[RegistryEntry], entry: RegistryEntry) → list[RegistryEntry]` | Add entry, raise if ID already exists. |
| `remove_entry` | `(entries: list[RegistryEntry], id: str) → list[RegistryEntry]` | Remove entry by ID, raise if not found. |

### Dependencies

- `spec/models.py` (RegistryEntry, Link)
- `core/fileio` (read_text, write_text)

## Plan

1. Implement `read_registry` — JSON parsing, schema validation, model hydration
2. Implement `write_registry` — atomic write (write temp → rename)
3. Implement `find_entry`, `add_entry`, `remove_entry` helpers
4. Write unit tests: round-trip read/write, atomic write behavior, error cases

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/spec/registry.py` | Create | Registry operations |
| `tests/spec/test_registry.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
