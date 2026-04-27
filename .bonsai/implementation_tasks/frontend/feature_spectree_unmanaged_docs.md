---
id: task-spectree-unmanaged-docs
type: task-spec
status: done
parent: frontmatter-registry
depends-on:
  - task-graph-documents
  - task-watcher-docs-notification
implements:
  - frontmatter-registry
covers:
  - frontend/src/components/SpecTree/SpecTree.tsx
  - frontend/src/components/SpecTree/treeUtils.ts
  - frontend/src/components/SpecTree/SpecTree.css
  - frontend/src/store/wireEvents.ts
tags:
  - frontend
  - unmanaged-docs
---

# SpecTree: Unmanaged Documents Section

> Render unmanaged documents in a collapsible section below the managed spec tree.

**Priority:** High
**Depends on:** `task-graph-documents`, `task-watcher-docs-notification`
**Spec reference:** [SpecTree README §Unmanaged Documents Section](../../../frontend/src/components/SpecTree/README.md#unmanaged-documents-section)

## Files to Modify

- `frontend/src/types/spec.ts` — add `DocumentEntry` interface, update `SpecGraph`
- `frontend/src/store/wireEvents.ts`
- `frontend/src/components/SpecTree/SpecTree.tsx`
- `frontend/src/components/SpecTree/treeUtils.ts` (optional — icon helper)
- `frontend/src/components/SpecTree/SpecTree.css`

## Changes

### 1. Update types manually
Spec types in `frontend/src/types/spec.ts` are **hand-written** (not codegen'd). Add:

```typescript
export interface DocumentEntry {
  path: string;
  title: string;
}
```

Update `SpecGraph`:
```typescript
export interface SpecGraph {
  nodes: RegistryEntry[];
  edges: Link[];
  documents: DocumentEntry[];  // NEW
}
```

> **Note:** The codegen pipeline (`npm run generate`) covers REST API types and WebSocket events, not spec RPC types. These must be updated manually to mirror `backend/app/spec/models.py`.

### 2. wireEvents.ts
Wire `docs/didChange` → `specStore.fetchGraph()`:

```typescript
client.on("docs/didChange", () => {
  useSpecStore.getState().fetchGraph();
});
```

### 3. SpecTree.tsx
- Add `docsCollapsed` local state (default: `true`)
- After the managed spec tree `{visible.map(...)}`, add:

```tsx
{graph?.documents && graph.documents.length > 0 && (
  <>
    <div className="st-doc-header" onClick={() => setDocsCollapsed(!docsCollapsed)}>
      <span className="st-arrow">{docsCollapsed ? "▸" : "▾"}</span>
      <span className="st-icon st-icon-default">📄</span>
      <span className="st-title">Unmanaged Documents ({graph.documents.length})</span>
    </div>
    {!docsCollapsed && graph.documents.map((doc) => (
      <div
        key={doc.path}
        className="st-doc-row"
        onClick={() => loadPreview(doc.path)}
        onDoubleClick={() => handleDoubleClick(doc.path)}
        title={doc.path}
      >
        <span className="st-icon st-icon-default">📄</span>
        <span className="st-title">{doc.title}</span>
      </div>
    ))}
  </>
)}
```

### 4. SpecTree.css
```css
.st-doc-header {
  display: flex;
  align-items: center;
  height: 28px;
  padding: var(--space-xs) var(--space-sm);
  cursor: pointer;
  color: var(--hint);
  margin-top: var(--space-sm);
  border-top: 1px solid var(--border);
}

.st-doc-header:hover { background: var(--hover); }

.st-doc-row {
  display: flex;
  align-items: center;
  height: 24px;
  padding: 0 var(--space-sm) 0 24px;
  cursor: pointer;
  color: var(--hint);
}

.st-doc-row:hover { background: var(--hover); }
```

## Verification

- `.md` files without frontmatter appear under "Unmanaged Documents" section
- Section is collapsed by default, shows correct count
- Clicking a doc opens it in the preview pane
- Adding frontmatter promotes the doc: it disappears from unmanaged section and appears in managed tree
- `npm run lint` passes (tsc + eslint)
