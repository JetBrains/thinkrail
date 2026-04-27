---
id: task-watcher-docs-notification
type: task-spec
status: done
parent: frontmatter-registry
depends-on:
  - task-graph-documents
implements:
  - frontmatter-registry
covers:
  - backend/app/rpc/server.py
tags:
  - backend
  - rpc
  - unmanaged-docs
---

# Watcher: Emit docs/didChange Notification

> Notify the frontend when unmanaged documents change.

**Priority:** High
**Depends on:** `task-graph-documents`
**Spec reference:** [FRONTMATTER_REGISTRY_DESIGN.md §9](../../design_docs/FRONTMATTER_REGISTRY_DESIGN.md#unmanaged-documents-support), [RPC README](../../../backend/app/rpc/README.md#spec-watcher-events)

## Files to Modify

- `backend/app/rpc/server.py`

## Changes

In `_on_file_change()`, after the watcher processes `.md` files:

1. If a changed `.md` file is **not** in `spec_paths` (i.e. it was indexed as an unmanaged document), emit `docs/didChange`
2. On file deletion, if the path was not a managed spec, also emit `docs/didChange`

```python
# After existing spec notification logic:
if summary is None and path.suffix == ".md":
    # Not a managed spec — must be an unmanaged document
    await bus.publish(project_topic, "docs/didChange", {})
```

Deduplicate: if multiple document changes happen in the same batch, emit `docs/didChange` only once.

## Verification

- Create a `.md` file without frontmatter → `docs/didChange` fires
- Modify an existing unmanaged `.md` → `docs/didChange` fires
- Delete an unmanaged `.md` → `docs/didChange` fires
- Modify a managed spec → only `spec/didChange` fires, NOT `docs/didChange`
