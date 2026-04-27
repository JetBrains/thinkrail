---
id: task-graph-documents
type: task-spec
status: done
parent: frontmatter-registry
depends-on:
  - task-document-entry-model
implements:
  - frontmatter-registry
covers:
  - backend/app/spec/graph.py
  - backend/app/spec/service.py
tags:
  - backend
  - unmanaged-docs
---

# Update Graph Builder and Service to Include Documents

> Pass unmanaged documents through the graph builder into the SpecGraph response.

**Priority:** Critical (blocks frontend work)
**Depends on:** `task-document-entry-model`
**Spec reference:** [FRONTMATTER_REGISTRY_DESIGN.md §9](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#unmanaged-documents-support)

## Files to Modify

- `backend/app/spec/graph.py`
- `backend/app/spec/service.py`

## Changes

### graph.py

Update `build_graph` to accept and pass through documents:

```python
def build_graph(
    entries: list[SpecEntry],
    links: list[Link],
    documents: list[DocumentEntry] | None = None,
) -> SpecGraph:
    return SpecGraph(nodes=list(entries), edges=list(links), documents=documents or [])
```

### service.py

Update `get_graph()` to fetch documents:

```python
async def get_graph(self) -> SpecGraph:
    entries = await self._index.get_all_specs()
    links = await self._index.get_all_links()
    documents = await self._index.get_all_documents()
    return build_graph(entries, links, documents)
```

## Verification

- `get_graph()` response includes `documents` field
- RPC `spec/graph` returns documents in JSON
- Existing graph tests still pass
