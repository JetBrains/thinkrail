---
id: task-test-skip-paths
type: task-spec
status: done
title: Tests for built-in skip paths
parent: unmanaged-docs-filtering
implements:
  - unmanaged-docs-filtering
depends-on:
  - task-builtin-skip-paths
covers:
  - backend/tests/spec/test_index.py
tags:
  - backend
  - testing
---

# Tests for Built-in Skip Paths

> Add test coverage for the `BONSAI_INTERNAL_SKIP` filtering in `_find_md_files()`.

**Priority:** High (validates Task 1)
**Spec reference:** [UNMANAGED_DOCS_FILTERING.md](../../design_docs/UNMANAGED_DOCS_FILTERING.md#backend-filtering-logic)

## Files to Modify

- `backend/tests/spec/test_index.py`

## Test Cases

### Positive (excluded)

- `.bonsai/trash/specs/deleted-spec/deleted-spec.md` → NOT in `get_all_documents()`
- `.bonsai/cache/some-cache.md` → NOT in `get_all_documents()`
- `.bonsai/sessions/session-log.md` → NOT in `get_all_documents()`
- `.bonsai/plans/brainstorm-plan.md` → NOT in `get_all_documents()`
- `.bonsai/design_docs/plans/implementation.md` → NOT in `get_all_documents()`

### Negative (still indexed)

- `.bonsai/design_docs/SOME_DESIGN.md` (no frontmatter) → IS in `get_all_documents()`
- `.bonsai/implementation_tasks/spec/some-task.md` (no frontmatter) → IS in `get_all_documents()`
- `README.md` (project root) → IS in `get_all_documents()`

### Schema bump

- Verify `SCHEMA_VERSION` is `"3"`
- Verify index with version `"2"` triggers rebuild

## Success Criteria

- All new tests pass
- Both positive (excluded) and negative (still indexed) cases covered
- No regressions in existing test suite

## Verification

```bash
pytest backend/tests/spec/test_index.py -v
```
