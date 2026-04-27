---
id: task-unmanaged-docs-tests
type: task-spec
status: done
parent: frontmatter-registry
depends-on:
  - task-document-entry-model
  - task-graph-documents
  - task-watcher-docs-notification
implements:
  - frontmatter-registry
covers:
  - backend/tests/spec/
tags:
  - backend
  - testing
  - unmanaged-docs
---

# Tests for Unmanaged Documents Support

> Backend tests covering the full unmanaged documents pipeline.

**Priority:** High
**Depends on:** All other unmanaged-docs tasks
**Spec reference:** [FRONTMATTER_REGISTRY_DESIGN.md §9](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#unmanaged-documents-support)

## Files to Create / Modify

- `backend/tests/spec/test_index.py` — add tests for `get_all_documents()`
- `backend/tests/spec/test_service.py` — add test for `get_graph()` with documents

## Test Cases

### test_index.py

```python
class TestGetAllDocuments:
    async def test_returns_unmanaged_documents_after_rebuild(self):
        # Rebuild with .md files (some with frontmatter, some without)
        # Assert get_all_documents() returns only the unmanaged ones

    async def test_returns_empty_when_no_documents(self):
        # Rebuild with only frontmatter files
        # Assert get_all_documents() returns []

    async def test_documents_sorted_by_path(self):
        # Create files z.md, a.md, m.md
        # Assert returned in alphabetical order

    async def test_promotion_removes_from_documents(self):
        # Create unmanaged .md, verify in documents
        # Add frontmatter, re-index, verify moved to specs
```

### test_service.py

```python
class TestGetGraphWithDocuments:
    async def test_graph_includes_documents(self):
        # Create spec + unmanaged doc, call get_graph()
        # Assert graph.documents is non-empty

    async def test_graph_documents_empty_by_default(self):
        # No unmanaged docs, call get_graph()
        # Assert graph.documents == []
```

## Verification

- `cd backend && uv run pytest` — all green
