# Implement Spec validator.py

> Validate spec structure, fields, and link integrity

**Status:** Done
**Priority:** Critical
**Started:** 2026-02-27
**Depends on:** `feature_spec_models`
**Spec reference:** `backend/app/spec/README.md`

## Summary

`validator.py` ensures specs conform to required structure. It validates individual spec fields (required fields present, correct types) and cross-spec link integrity (all link targets exist, no orphaned references). Used by the service layer before writes and during health checks.

## Public Interface

| Function | Signature | Description |
|----------|-----------|-------------|
| `validate_spec` | `(spec: Spec, entry: RegistryEntry) → list[str]` | Validate a single spec's structure and fields. Returns list of error messages (empty = valid). |
| `validate_links` | `(links: list[Link], entries: list[RegistryEntry]) → list[str]` | Validate link integrity across the spec graph. Returns list of error messages (empty = valid). |

### Checks

- **validate_spec:** required fields present, type is recognized, path is valid
- **validate_links:** all `from_id`/`to_id` reference existing entries, no self-links, link types are recognized

### Dependencies

- `spec/models.py` (Spec, RegistryEntry, Link)

## Plan

1. Define recognized spec types and link types as constants
2. Implement `validate_spec` — field presence, type checking, path validation
3. Implement `validate_links` — referential integrity, self-link detection
4. Write unit tests: valid specs, missing fields, invalid links, orphaned refs

## Files

| File | Action | Description |
|------|--------|-------------|
| `backend/app/spec/validator.py` | Create | Validation logic |
| `tests/spec/test_validator.py` | Create | Unit tests |

## Definition of Done

- All unit tests pass
- Implementation matches the public interface defined in the module spec
