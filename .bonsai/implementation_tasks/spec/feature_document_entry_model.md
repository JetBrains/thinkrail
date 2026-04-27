---
id: task-document-entry-model
type: task-spec
status: done
parent: frontmatter-registry
implements:
  - frontmatter-registry
covers:
  - backend/app/spec/models.py
  - backend/app/spec/index.py
tags:
  - backend
  - unmanaged-docs
---

# Add DocumentEntry Model and Index Query

> Add the `DocumentEntry` Pydantic model and `get_all_documents()` query method.

**Priority:** Critical (blocks all other tasks)
**Spec reference:** [FRONTMATTER_REGISTRY_DESIGN.md §9](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#unmanaged-documents-support)

## Files to Modify

- `backend/app/spec/models.py`
- `backend/app/spec/index.py`

## Changes

### models.py

Add `DocumentEntry` model:

```python
class DocumentEntry(BaseModel):
    """A row in the SQLite documents table — an unmanaged .md file."""
    path: str   # relative to project root
    title: str  # from first # heading or filename
```

Add `documents` field to `SpecGraph`:

```python
class SpecGraph(BaseModel):
    nodes: list[SpecEntry] = Field(default_factory=list)
    edges: list[Link] = Field(default_factory=list)
    documents: list[DocumentEntry] = Field(default_factory=list)
```

### index.py

Add `get_all_documents()` to `SpecIndex`:

```python
async def get_all_documents(self) -> list[DocumentEntry]:
    async with self._db.execute(
        "SELECT path, title FROM documents ORDER BY path"
    ) as cur:
        return [DocumentEntry(path=row["path"], title=row["title"])
                async for row in cur]
```

## Verification

- Existing tests pass (`uv run pytest`)
- `SpecGraph().model_dump()` includes `documents: []` by default
- After rebuild with mixed files, `get_all_documents()` returns only unmanaged ones
