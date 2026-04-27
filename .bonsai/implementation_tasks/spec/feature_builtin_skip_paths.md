---
id: task-builtin-skip-paths
type: task-spec
status: done
title: Add built-in skip paths to _find_md_files()
parent: unmanaged-docs-filtering
implements:
  - unmanaged-docs-filtering
covers:
  - backend/app/spec/index.py
tags:
  - backend
  - filtering
---

# Add Built-in Skip Paths to `_find_md_files()`

> Add index-time filtering for `.bonsai/` infrastructure dirs so they never appear as unmanaged documents.

**Priority:** Critical (blocks frontend display — filtered data feeds the tree)
**Spec reference:** [UNMANAGED_DOCS_FILTERING.md](../../design_docs/UNMANAGED_DOCS_FILTERING.md#backend-filtering-logic)

## Files to Modify

- `backend/app/spec/index.py`

## Changes

### index.py

1. Add `BONSAI_INTERNAL_SKIP` constant — a set of path prefixes:
   - `.bonsai/trash`
   - `.bonsai/cache`
   - `.bonsai/sessions`
   - `.bonsai/plans`
   - `.bonsai/design_docs/plans`

2. In `_find_md_files()`, after the existing `.bonsai` exception (which allows `.bonsai/` through while blocking other hidden dirs), add a prefix-match check against `BONSAI_INTERNAL_SKIP`.

3. Bump `SCHEMA_VERSION` from `"2"` to `"3"` to force a full index rebuild on next startup.

## Success Criteria

- `.md` files under each skip path are excluded from the `documents` table after rebuild
- `.md` files in non-skipped `.bonsai/` dirs (e.g., `design_docs/`, `implementation_tasks/`) continue to be indexed
- Existing `.bonsaihide` filtering is unchanged
- All existing tests pass

## Verification

```bash
pytest backend/tests/spec/test_index.py -v
```
