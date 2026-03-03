# Implement Spec parser.py

> Parse Markdown and JSON spec files from disk

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Depends on:** `feature_spec_models`, `feature_core_fileio`
**Spec reference:** `backend/app/spec/README.md`

## Files to Modify

- `backend/app/spec/parser.py`

## Summary

`parser.py` reads spec files from the filesystem and returns structured `Spec` objects. It handles two formats: Markdown (narrative specs like README.md) and JSON (structured data specs). The parser is used by the service layer for all read operations.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `parse_spec` | `(path: Path) → Spec` | Read a file from disk and return a Spec object |

### Behavior

- Detect format by file extension (`.md` → Markdown, `.json` → JSON)
- For Markdown: `content` = raw text, `metadata` = None
- For JSON: `content` = raw text, `metadata` = parsed dict
- Raise appropriate error if file not found or unparseable

### Dependencies

- `spec/models.py` (Spec model)
- `core/fileio` (read_text)

## Plan

1. Implement format detection from file extension
2. Implement Markdown parsing path (read → Spec with metadata=None)
3. Implement JSON parsing path (read → Spec with metadata=parsed dict)
4. Add error handling for missing files and malformed JSON
5. Write unit tests with fixture spec files (both formats)

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/spec/parser.py` | Create | Parsing logic |
| `tests/spec/test_parser.py` | Create | Unit tests with fixtures |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
