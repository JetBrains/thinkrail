---
id: diff-viewer
type: submodule-design
title: Diff Viewer
parent: webview
depends-on:
- module-spec
covers:
- frontend/src/components/DiffViewer/
tags:
- frontend
- ui
- diff
- git
---
# Diff Viewer — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §4.4 | Status: **Draft** | Created: 2026-03-02

> **Note:** This is a design document for a **planned feature**. The current code is a stub placeholder. No backend diff methods, mapping files, types, or CSS classes described below have been implemented yet.

## Overview

The Diff Viewer is a right-panel tab showing **spec changes alongside corresponding code changes** in a side-by-side layout. It uses a hybrid approach: git commit data is automatically extracted and stored into mapping files that link spec sections to code patches. Users can refine mappings through agent sessions.

## Core Concept: Spec-to-Code Mapping

The central idea is that spec changes *cause* code changes. The Diff Viewer visualizes this causal relationship by pairing spec diffs with code diffs.

### Mapping Data Flow

```
Git commits
    ↓ (extract)
Mapping files (.bonsai/mappings.json + per-spec .[name]_mappings.json)
    ↓ (read)
Diff Viewer
    ↓ (display)
Side-by-side: spec diff ←→ code diff
```

### Mapping Sources

1. **Automatic (git-based):** When a commit modifies both a spec file and code files covered by that spec, the system automatically creates a mapping entry pairing the spec diff with the code diff.
2. **Agent-assisted:** User triggers "Map spec to code" from context menu → opens a session with a specialized prompt that asks the agent to identify which spec sections correspond to which code changes, then writes the mapping file.

## 1. Component Hierarchy

```
<DiffView>                             // right-panel tab content
  <DiffNavBar>                         // commit navigation + spec selector
    <DiffSpecSelector />               // which spec's diffs to show
    <DiffCommitNav>                    // ← prev | commit info | next →
      <CommitPrev />
      <CommitInfo />                   // hash, message, date
      <CommitNext />
    </DiffCommitNav>
  </DiffNavBar>
  <DiffSplitPane>                      // side-by-side container
    <DiffPane side="spec">             // left: spec changes
      <DiffPaneHeader />              // "SPEC DIFF" + file path
      <DiffLines>                      // diff content
        <DiffLine /> ...               // add/del/context lines
      </DiffLines>
    </DiffPane>
    <DiffPaneSplitter />               // draggable divider
    <DiffPane side="code">             // right: code changes
      <DiffPaneHeader />              // "CODE DIFF" + file path
      <DiffLines>
        <DiffLine /> ...
      </DiffLines>
    </DiffPane>
  </DiffSplitPane>
  <DiffEmptyState />                   // no diffs available
</DiffView>
```

## 2. Mapping File Format

### Project-wide mapping: `.bonsai/mappings.json`

Index of all spec-to-code mappings. Points to per-spec mapping files.

```json
{
  "version": "1.0",
  "specs": {
    "module-spec": {
      "mappingFile": ".module-spec_mappings.json",
      "lastUpdated": "2026-03-02T14:30:00Z"
    },
    "module-core": {
      "mappingFile": ".module-core_mappings.json",
      "lastUpdated": "2026-03-01T10:00:00Z"
    }
  }
}
```

### Per-spec mapping: `.[spec-id]_mappings.json`

Stored near the corresponding specification file (same directory).

```json
{
  "specId": "module-spec",
  "specPath": "backend/app/spec/README.md",
  "entries": [
    {
      "id": "mapping-001",
      "commit": "abc1234",
      "commitMessage": "Implement spec CRUD models",
      "date": "2026-03-01T14:30:00Z",
      "source": "auto",
      "specDiff": {
        "file": "backend/app/spec/README.md",
        "hunks": [
          { "startLine": 42, "endLine": 55, "sectionHeader": "## Components / models.py" }
        ]
      },
      "codeDiffs": [
        {
          "file": "backend/app/spec/models.py",
          "hunks": [
            { "startLine": 1, "endLine": 45 }
          ]
        }
      ]
    }
  ]
}
```

### Entry Fields

| Field | Description |
| --- | --- |
| `id` | Unique mapping ID |
| `commit` | Git commit hash |
| `commitMessage` | Commit message for display |
| `date` | Commit timestamp |
| `source` | `"auto"` (git-extracted) or `"agent"` (agent-assisted) or `"manual"` |
| `specDiff.file` | Spec file path |
| `specDiff.hunks` | Changed regions in the spec, with optional `sectionHeader` |
| `codeDiffs` | Array of code file changes paired with this spec change |
| `codeDiffs[].file` | Code file path |
| `codeDiffs[].hunks` | Changed line ranges in the code file |

## 3. Auto-Extraction Algorithm

Triggered by the backend file watcher or on manual refresh:

```
For each new git commit:
  1. Get changed files in commit (git diff --name-only)
  2. For each changed spec file:
     a. Find registry entry for this spec
     b. Find code files in same commit that are within spec's `covers` paths
     c. If any match → create mapping entry:
        - Extract spec hunks (git diff for spec file)
        - Extract code hunks (git diff for covered files)
        - Identify spec section headers from hunk context
        - Write to per-spec mapping file
        - Update .bonsai/mappings.json index
```

### Backend API Additions

| Method | Params | Returns | Description |
| --- | --- | --- | --- |
| `diff/mappings` | `{ specId: str }` | `MappingEntry[]` | Get all mappings for a spec |
| `diff/commit` | `{ specId: str, commit: str }` | `CommitDiff` | Get full diff content for a specific mapping |
| `diff/scan` | `{ specId?: str }` | `{ newMappings: number }` | Scan git history for new mappings |

## 4. Agent-Assisted Mapping

When automatic mapping is insufficient (e.g., spec and code changed in separate commits), users can refine mappings via an agent session:

1. User right-clicks a spec node → "Map spec to code"
2. Opens a new session with a specialized prompt:
   - "Analyze the relationship between this spec and its covered code files. Identify which spec sections correspond to which code implementations. Write the mapping file."
3. Agent reads the spec, reads the code, and generates/updates the `.[spec-id]_mappings.json` file
4. Diff Viewer automatically refreshes on file change (via watcher)

## 5. Diff Display

### Side-by-Side Layout

```
┌──────────────────────┬──────────────────────┐
│  SPEC DIFF           │  CODE DIFF           │
│  backend/app/spec/   │  backend/app/spec/   │
│  README.md           │  models.py           │
│──────────────────────│──────────────────────│
│  ## Components       │                      │
│                      │  from pydantic ...   │
│- ### models (draft)  │+ class SpecType:     │
│+ ### models.py       │+     GOAL = "goal"   │
│+ Pydantic models:    │+     ARCH = "arch"   │
│+ Spec, RegistryEntry │+                     │
│                      │+ class RegistryEntry:│
│  ### service.py      │+     id: str         │
└──────────────────────┴──────────────────────┘
```

### Line Styling

| Type | Background | Text Color | Prefix |
| --- | --- | --- | --- |
| Addition | `rgba(--green, .08)` | `--green` | `+` |
| Deletion | `rgba(--red, .08)` | `--red` | `-` |
| Context | transparent | `--hint` | (space) |
| Section header | transparent | `--blue`, bold | `@@` |

### Synchronized Scrolling

Both panes scroll together by default. A "lock" toggle in the nav bar allows independent scrolling.

- Lock icon: 🔗 (linked) / 🔓 (independent)
- Default: linked
- Scroll sync maps line positions proportionally (since spec and code have different line counts)

## 6. Commit Navigation

The nav bar shows commit-by-commit navigation:

```
┌─────────────────────────────────────────────────────┐
│  [Spec Module ▾]  │  ← │ abc1234 "Implement CRUD" │ → │
└─────────────────────────────────────────────────────┘
```

- **Spec selector:** dropdown of specs that have mappings
- **Commit nav:** `←` previous / `→` next commit, sorted by date (newest first)
- **Commit info:** short hash + first line of commit message + date
- **Auto-select:** when context-linked to a spec, auto-selects that spec and shows the latest mapping

### No Mappings State

```
┌──────────────────────────────────────┐
│                                      │
│  No diff mappings for this spec.     │
│                                      │
│  [Scan git history]                  │
│  [Map with agent]                    │
│                                      │
└──────────────────────────────────────┘
```

## 7. Keyboard Shortcuts

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

| Key | Action |
| --- | --- |
| `[` / `]` | Previous / next commit |
| `Mod+D` | Focus diff view |

## 8. State

```typescript
interface DiffState {
  selectedSpecId: string | null;
  mappings: MappingEntry[];          // for current spec
  currentMappingIndex: number;       // which commit is shown
  currentDiff: CommitDiff | null;    // full diff content
  scrollLocked: boolean;             // sync scroll toggle
  loading: boolean;
}
```

## 9. CSS Classes

| Class | Element |
| --- | --- |
| `.diff-container` | Side-by-side wrapper |
| `.diff-pane` | Individual pane (spec or code) |
| `.diff-pane-header` | Pane header (title + file path) |
| `.diff-line` | Single diff line |
| `.diff-line.add` | Addition (green) |
| `.diff-line.del` | Deletion (red) |
| `.diff-line.ctx` | Context (gray) |
| `.diff-line.section` | Section header (blue) |
| `.diff-nav` | Navigation bar |
| `.diff-commit-nav` | Commit prev/next controls |
| `.diff-empty` | Empty state |
| `.diff-scroll-lock` | Scroll sync toggle |

## Known Limitations

- **Auto-extraction requires co-committed changes:** Spec and code must change in the same git commit for auto-mapping
- **No inline annotations:** Cannot annotate individual diff lines with comments
- **Section-level mapping not automatic:** Agent-assisted mapping required for fine-grained spec-to-code correlation

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §4.4
- **Depends on:** [Spec Module](../../backend/app/spec/README.md) (covers field, spec content), [API Client](../src/api/README.md) (diff/* methods)
