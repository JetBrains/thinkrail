---
id: unmanaged-docs-filtering
type: submodule-design
status: done
title: Unmanaged Documents Filtering & Display
parent: frontmatter-registry
depends-on:
- module-spec
- spec-tree
covers:
- backend/app/spec/index.py
- frontend/src/components/SpecTree/
tags:
- filtering
- frontend
- backend
---
# Unmanaged Documents Filtering & Display — Design Document

> Status: **Done** | Created: 2026-04-20 | Parent: [Frontmatter Registry](FRONTMATTER_REGISTRY_DESIGN.md)

## Problem

After index rebuild, the unmanaged documents section in SpecTree surfaces **all** `.md` files without spec frontmatter — including `.bonsai/` infrastructure files (trash, cache, session logs, plans) that are never meaningful to users. In large projects this list grows quickly, burying genuine project docs among noise.

## Product Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| P1 | Filtering approach | Built-in indexer skips + `.bonsaihide` | Universal noise (`.bonsai/` internals) handled by code. Project-specific noise handled by user via `.bonsaihide`. |
| P2 | Built-in skip paths | `.bonsai/trash/`, `.bonsai/cache/`, `.bonsai/sessions/`, `.bonsai/plans/`, `.bonsai/design_docs/plans/` (trailing `/` for safe prefix matching) | Bonsai infrastructure dirs — managed by the tool, never user-facing specs. |
| P3 | Display model | Reuse existing FileTree component's visual language | Collapsing, indentation, path-collapse already exist. Consistent UI. |
| P4 | Promote-to-spec UX | Deferred | Filtering + display first. Manual frontmatter addition remains the promotion path. |
| P5 | Intent distinction | Deferred | No visual signal for "intentionally unmanaged" vs "forgot frontmatter". |

### Scope

**In:** Built-in skip rules for `.bonsai/` internal dirs, FileTree-based rendering with path-collapsing.
**Out:** Promote action, intent signals, search/filter within unmanaged docs.

### Success Criteria

1. `.bonsai/` infrastructure files never appear in unmanaged docs
2. Unmanaged docs render as collapsible file tree (FileTree visual language)
3. Empty intermediate directories collapsed
4. `.bonsaihide` filtering unchanged
5. No regressions in spec tree or watcher

## Technical Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| T1 | Tree rendering | `buildDocTree()` in `treeUtils.ts` | Self-contained in SpecTree module. No FileTree refactoring risk. Uses `st-` namespace CSS classes, following FileTree's visual language. |
| T2 | Filter stage | Index time (`_find_md_files`) | Consistent with how `.bonsaihide` already works — both exclude files before they enter the DB. Index is a rebuildable cache, so rule changes just need a rebuild. |
| T3 | Schema bump | `"2"` → `"3"` | Forces full rebuild on next startup, applying the new skip rules to existing indexes without manual intervention. |

### Backend: Filtering Logic

**Where:** `_find_md_files()` already has three exclusion layers (hidden dirs, `skip_dirs` set, `.bonsaihide` patterns). The built-in `.bonsai/` skip paths become a **fourth layer** — a constant set of prefix patterns checked during the file walk.

**Why a constant, not config:** These paths are Bonsai infrastructure — they exist in every project and are never meaningful as unmanaged docs. Making them configurable adds complexity with no benefit. If the set needs updating, it's a code change (same as `skip_dirs`).

**Paths skipped:** `.bonsai/trash/`, `.bonsai/cache/`, `.bonsai/sessions/`, `.bonsai/plans/`, `.bonsai/design_docs/plans/`

### Frontend: Tree Building

**What:** A new pure function `buildDocTree(documents: DocumentEntry[]) → DocTreeNode[]` in `treeUtils.ts`.

**Logic:**
1. Extract unique directory paths from document paths
2. Collapse empty intermediate directories — if a dir has exactly one child (another dir) and zero files, merge the names (IntelliJ compact path style)
3. Sort each level: directories first (alphabetical), then files (alphabetical)
4. DFS flatten with depth values for indentation

**Why in treeUtils.ts, not a new file:** The function operates on the same graph data and follows the same pattern as `buildTree()`. Keeping it colocated aids discoverability and makes the relationship explicit.

**Rendering:** Replace the current flat `doc.map()` in SpecTree with the depth-sorted tree. Uses `st-doc-dir` / `st-doc-row` CSS classes (following FileTree's visual language but within SpecTree's `st-` namespace) for collapse arrows, indentation, and hover states. Local `docDirCollapsed: Set<string>` state (separate from the spec tree's `collapsed` state) controls expand/collapse.

### Files Changed

| File | Change Type | What |
|------|-------------|------|
| `backend/app/spec/index.py` | Modify | Add skip-path constant + filtering layer, bump schema |
| `frontend/.../SpecTree/treeUtils.ts` | Modify | Add `buildDocTree()` + `DocTreeNode` type |
| `frontend/.../SpecTree/SpecTree.tsx` | Modify | Replace flat doc list with tree render |
| `frontend/.../SpecTree/SpecTree.css` | Modify | Add `.st-doc-dir` for directory rows |
| `backend/tests/spec/test_index.py` | Modify | Tests for built-in skip paths |

### Data Flow

```
_find_md_files() → skip .bonsai internals → reindex_file() → documents table
    → get_all_documents() → SpecGraph.documents
        → WS → specStore → SpecTree → buildDocTree() → render tree
```

### Known Limitations

- **Explicit skip list:** The built-in skip paths are an explicit constant. New `.bonsai/` subdirs (e.g., `spec-drafts/`, `spec-patches/`, `meta-tickets/`) would need to be added manually if they start containing `.md` files. This is a deliberate choice for transparency over fragility of an "allow-list" approach.
