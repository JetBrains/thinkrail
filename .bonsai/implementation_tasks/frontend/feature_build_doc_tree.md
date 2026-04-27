---
id: task-build-doc-tree
type: task-spec
status: done
title: Add buildDocTree() to treeUtils.ts
parent: unmanaged-docs-filtering
implements:
  - unmanaged-docs-filtering
covers:
  - frontend/src/components/SpecTree/treeUtils.ts
tags:
  - frontend
  - ui
---

# Add `buildDocTree()` to `treeUtils.ts`

> Implement the pure function that transforms a flat `DocumentEntry[]` into a depth-sorted tree with path collapsing.

**Priority:** Critical (blocks SpecTree rendering task)
**Spec reference:** [UNMANAGED_DOCS_FILTERING.md](../../design_docs/UNMANAGED_DOCS_FILTERING.md#frontend-tree-building)

## Files to Modify

- `frontend/src/components/SpecTree/treeUtils.ts`

## Changes

### DocTreeNode interface

```typescript
interface DocTreeNode {
  path: string;       // full relative path (or collapsed display path for dirs)
  name: string;       // display name (basename or collapsed dirname)
  isDir: boolean;
  depth: number;
}
```

### buildDocTree() logic

1. **Extract dirs** — collect unique parent directory paths from all document paths
2. **Collapse empty intermediates** — if a dir has exactly one child (another dir) and zero files, merge the names (IntelliJ compact path style, e.g., `claude-plugin/skills/` when `skills/` has no direct files)
3. **Sort** — directories first (alphabetical), then files (alphabetical) at each level
4. **DFS flatten** — assign depth values for indentation

### Edge cases

- Empty input → return `[]`
- Single file at root → one file node at depth 0
- All files in same dir → one dir node + file children
- Deeply nested with only single-child dirs → collapsed path

## Success Criteria

- Pure function, no side effects, no store dependencies
- Correctly handles all edge cases above
- Unit testable without React

## Verification

```bash
cd frontend && npm test -- --grep "buildDocTree"
```
