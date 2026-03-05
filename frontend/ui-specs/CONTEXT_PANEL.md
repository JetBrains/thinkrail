# Context Panel — UI Specification

> Parent: [WEBVIEW.md](WEBVIEW.md) | Status: **Active** | Created: 2026-03-04

## Table of Contents
1. [Purpose](#purpose)
2. [Overview](#overview)
3. [Context Modes](#context-modes)
4. [Section Components](#section-components)
5. [Mode Derivation](#mode-derivation)
6. [Shared Patterns](#shared-patterns)
7. [Design Decisions](#design-decisions)
8. [Known Limitations](#known-limitations)
9. [Implementation Notes](#implementation-notes)
10. [Sub-Specifications](#sub-specifications)
11. [Related Specs](#related-specs)

## Purpose

The Context Panel is a context-aware sidebar (the right panel in the three-panel layout) that displays information related to the active content in the center panel. It auto-switches between three modes — **Spec Context**, **Agent Context**, and **Code Context** — showing connected specs, linked tasks, and covered files depending on what the user is working on. When nothing is selected, the panel shows an empty welcome state.

**Key interaction:** Single-clicking a file in FileTree or a spec in SpecTree opens a **preview tab** in the center panel and immediately updates the context panel. Double-click pins the tab (fully opens it). This gives users instant context feedback while browsing.

**Replaces:** The previous tab-based right panel (`Graph | Spec | Code | Diff | Console`). Console is removed from the UI for now. Rich views (graphs, full spec text) show compact previews in the sidebar with a "peek-to-center" expand button `[⇱]` to open the full view in the center panel.

## Overview

```
┌──────────┬────────────────────────┬──────────────────────┐
│  LEFT    │      CENTER            │   CONTEXT PANEL      │
│  PANEL   │                        │   (right, 380px)     │
│          │  Spec open?            │→  Spec Context        │
│          │  Agent session?        │→  Agent Context       │
│          │  Code file open?       │→  Code Context        │
│          │  Nothing?              │→  Empty/welcome state  │
└──────────┴────────────────────────┴──────────────────────┘
```

The panel has **no tabs**. Content auto-switches based on what's in the center panel. A small **mode indicator** at the top shows the current mode (icon + label, e.g., "📋 Spec Context" or "🤖 Agent Context"). Below it, each mode renders a vertical stack of **collapsible sections** — each section is a self-contained component showing one type of contextual information.

## Context Modes

### 1. Spec Context

**Trigger:** A spec file is open or previewed in the center panel, or a spec is selected in the SpecTree (single-click previews the spec file and activates this mode).

**Sections (top to bottom):**

| Section | Shows | Peek-to-center |
|---------|-------|---------------|
| **Connected Specs** | Mini subgraph: parent, children, siblings of current spec (3-5 nodes, clickable) | Yes — opens full GraphView in center, focused on this spec |
| **Linked Tasks** | Task specs linked to this spec via registry, with status badges (done/wip/todo) | No — click individual task to open |
| **Covered Files** | Code files this spec covers (from registry `covers`), with relative modification time | No — click file to open |
| **Spec Health** | Status, last updated, completeness score, lint warnings. Collapsed by default, shows summary bar. | No |

```
┌──────────────────────────────┐
│ ▼ Connected Specs        [⇱] │
│   ┌────┐   ┌────────┐       │
│   │goal│──▶│  arch  │       │
│   └────┘   └───┬────┘       │
│            ┌───▼────┐       │
│            │►module │       │
│            └────────┘       │
├──────────────────────────────┤
│ ▼ Tasks (3)                  │
│   ✓ Implement parser  done   │
│   ◉ Add validation    wip    │
│   ○ Write tests       todo   │
├──────────────────────────────┤
│ ▼ Covered Files (5)          │
│   app/spec/parser.py     2d  │
│   app/spec/models.py     5d  │
│   app/spec/validator.py  1w  │
├──────────────────────────────┤
│ ▶ Spec Health      ▃▃▃▃▃ 85%│
└──────────────────────────────┘
```

### 2. Agent Context

**Trigger:** An agent session is active (running or awaiting user input).

**Sections (top to bottom):**

| Section | Shows | Peek-to-center |
|---------|-------|---------------|
| **Task Spec Preview** | Compact view of the task spec driving this session — title + key requirements | Yes — opens full task spec in center |
| **Files Modified** | Live-updating list of files the agent has created/modified/deleted (from tool call events) | No — click file to open |
| **Related Specs** | Specs relevant to the session (task's parent specs, sibling specs) — compact list with type icon + status badge | No — click to open |
| **Compliance Hints** | Heuristic tracking: which task requirements appear addressed vs still pending | No |

```
┌──────────────────────────────┐
│ ▼ Task Spec              [⇱] │
│   "Add spec validation"      │
│   • Parse frontmatter        │
│   • Validate links           │
│   • Report errors            │
├──────────────────────────────┤
│ ▼ Files Modified (3)         │
│   + app/spec/validator.py    │
│   ~ app/spec/service.py      │
│   + tests/test_validator.py  │
├──────────────────────────────┤
│ ▼ Related Specs (3)          │
│   📋 Spec Module     • active │
│   📄 Parser Design   • active │
│   ☑  Add validation  • wip   │
├──────────────────────────────┤
│ ▼ Compliance          2/3    │
│   ✓ Parse frontmatter        │
│   ✓ Validate links           │
│   ○ Report errors            │
└──────────────────────────────┘
```

### 3. Code Context

**Trigger:** A non-spec file is open or previewed in the center panel (single-click on a file in FileTree previews it and activates this mode).

**Sections (top to bottom):**

| Section | Shows | Peek-to-center |
|---------|-------|---------------|
| **Covering Specs** | Specs whose `covers` field includes this file's path — compact list with type icon + status | No — click to open |
| **Related Tasks** | Tasks linked to the covering specs | No — click to open |
| **Spec Health** | Staleness indicator: compare file modification time vs covering spec update time | No |

```
┌──────────────────────────────┐
│ ▼ Covering Specs (2)         │
│   📋 Spec Module     • active │
│   📄 Parser Design   • active │
├──────────────────────────────┤
│ ▼ Related Tasks (2)          │
│   ✓ Implement parser  done   │
│   ◉ Add validation    wip    │
├──────────────────────────────┤
│ ▼ Spec Health                │
│   Covered by 2 specs         │
│   Last spec update: 3d ago   │
│   File modified: 1d ago      │
│   ⚠ Spec may be stale        │
└──────────────────────────────┘
```

### 4. Empty State

**Trigger:** No file or session is active — the "home" state.

Shows a simple welcome message: *"Select a file, spec, or agent session to see context."* The mode header is hidden in this state.

```
┌──────────────────────────────┐
│                              │
│  Select a file, spec, or    │
│  agent session to see        │
│  context.                    │
│                              │
└──────────────────────────────┘
```

## Section Components

Each section listed above is an independent React component. They share a common `CollapsibleSection` wrapper.

### CollapsibleSection (shared)

```typescript
interface CollapsibleSectionProps {
  title: string;
  count?: number;               // badge: "Tasks (3)"
  defaultExpanded?: boolean;
  expandToCenter?: () => void;  // if provided, shows [⇱] button
  summary?: React.ReactNode;    // shown when collapsed (e.g., progress bar)
  children: React.ReactNode;
}
```

**Behavior:**
- Click header to expand/collapse
- Collapsed state persisted per section key via `localStorage`
- `[⇱]` button opens content as full view in center panel
- Smooth expand/collapse animation (CSS `max-height` transition)
- Count badge updates reactively

### Section List

| Component | Used in modes | Data source |
|-----------|--------------|-------------|
| `ConnectedSpecs` | spec | `specStore.graph` — filtered to neighbors |
| `LinkedTasks` | spec | Registry links filtering tasks |
| `CoveredFiles` | spec | Registry `covers` + file mod times |
| `SpecHealth` | spec, code | Spec status, dates, lint results |
| `TaskSpecPreview` | agent | Session specIds → spec content |
| `FilesModified` | agent | Agent tool call events (live) |
| `RelatedSpecs` | agent | Session specIds + graph neighbors |
| `ComplianceHints` | agent | Heuristic: agent output vs spec requirements |
| `CoveringSpecs` | code | Registry entries matching file path |
| `RelatedTasks` | code | Tasks linked to covering specs |

## Mode Derivation

The active mode is derived from Zustand stores. The hook reads both `activeFilePath` (pinned/opened files) and `previewFilePath` (single-click preview), preferring preview when present:

```typescript
type ContextMode = 'spec' | 'agent' | 'code' | 'empty';

function useContextMode(): ContextMode {
  const activeSessionId = useSessionStore(s => s.activeSessionId);
  const activeFilePath = useFileStore(s => s.activeFilePath);
  const previewFilePath = useFileStore(s => s.previewFilePath);
  const selectedSpecId = useSpecStore(s => s.selectedSpecId);

  // Only one of these is active at a time (mutually exclusive in the store layer)
  const focusedFile = previewFilePath ?? activeFilePath;

  if (focusedFile) return isSpecFile(focusedFile) ? 'spec' : 'code';
  if (activeSessionId) return 'agent';
  if (selectedSpecId) return 'spec';
  return 'empty';
}
```

**Only one thing is focused at a time.** The center panel shows either a session, a file, a preview, or nothing — these are mutually exclusive. The context mode simply reflects what's currently shown: file/preview → spec or code context, session → agent context, nothing → empty. The `selectedSpecId` fallback exists for edge cases where a spec is selected in the tree but no file is open.

**Preview interaction:** The `previewFilePath` is set by single-click in FileTree or SpecTree. It is cleared when:
- The user switches to a different pinned tab (context follows the pinned tab)
- The user starts/switches to an agent session
- The user double-clicks to pin the preview (it becomes `activeFilePath`)

See [CENTER_PANEL.md — Preview Tabs](CENTER_PANEL.md#preview-tabs) for full preview tab lifecycle.

## Shared Patterns

### Peek-to-Center

Sections with rich content (graphs, full spec) show a compact preview in the sidebar. The `[⇱]` button in the section header opens the full version in the center panel.

```
Section header:  ▼ Connected Specs  [⇱]
                                     │
                                     └── click opens full GraphView
                                         in center, focused on this spec
```

This solves the tension between the sidebar being too narrow for full views (380px) and users wanting quick access to the information.

### Status Badges

Consistent badges across all sections:

| Badge | Meaning |
|-------|---------|
| `✓` / green | Done / active |
| `◉` / amber | In progress / WIP |
| `○` / gray | Todo / pending |
| `⚠` / yellow | Warning (stale, missing coverage) |

### Click-to-Navigate

All clickable items (specs, tasks, files) in context panel sections open in the center panel via store actions:
- Spec → `specStore.selectSpec(id)` + `fileStore.loadPreview(path)`
- Task → `fileStore.loadPreview(taskPath)`
- File → `fileStore.loadPreview(filePath)`

Clicking items within context panel sections creates preview tabs (single-click pattern). Double-clicking pins them.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| No tabs, context-driven | Auto-switch based on center panel state | Reduces cognitive load — user doesn't have to manually find relevant info. Linear's peek and Figma's inspector panel validate this pattern. |
| Stacked collapsible sections | Vertically stacked cards, each collapsible | Most common pattern for inspector/properties panels (Figma, Chrome DevTools, JetBrains). Allows scanning multiple info types. User controls density via collapse. |
| Peek-to-center | Compact preview + `[⇱]` expand button for rich content | 380px is too narrow for full graph/spec. Inspired by Linear peek and Notion side peek. |
| Mode from stores + preview | `useContextMode()` reads sessionStore + fileStore (activeFilePath + previewFilePath) + specStore | Single source of truth. Preview file takes precedence over active file so context updates on single-click. |
| Compact list for agent specs | List with type icon + status, not subgraph | Active sessions need minimal visual noise. Graph available via `[⇱]` if needed. |
| Console removed | Not in context panel or anywhere in UI for now | Not core to spec-driven workflow. Add back later if needed (likely as bottom drawer). |
| Compliance is heuristic | Pattern match agent actions against spec requirements | True compliance requires code analysis. Heuristic gives useful signal without complexity. Clearly labeled as approximate. |

## Known Limitations

- **Compliance hints are heuristic:** Pattern-matching agent actions against spec requirements is approximate, not verified.
- **Graph preview simplified:** Mini subgraph shows direct connections only (parent, children, siblings), not full hierarchy.
- **Context switch latency:** Auto-switching may have brief loading states when fetching data.
- **No manual mode override:** Panel always follows center panel state. Pin/lock toggle can be added if needed.

## Implementation Notes

- The Context Panel has replaced `RightPanel.tsx` — it is now integrated in `AppShell.tsx` as `<ContextPanel />`
- `rightActiveTab` and `setRightTab` have been removed from `uiStore` (no tabs needed)
- Each mode component (`SpecContext`, `AgentContext`, `CodeContext`) is a composition of section components; the `empty` mode renders a simple welcome message inline
- Section components are independent and reusable — some appear in multiple modes (e.g., `SpecHealth` in both spec and code modes)
- The panel has no fixed max-width — it is dynamically capped by available viewport space (respects center panel's 300px min-width and left panel width)
- When collapsed, a thin `◀` button (`.right-collapse-btn`, 20px wide) remains visible on the right edge, allowing re-expansion without a keyboard shortcut
- The `useContextMode` hook lives in `ContextPanel/useContextMode.ts`, not in a store
- The hook reads `fileStore.previewFilePath` (new) in addition to `activeFilePath` — see [CENTER_PANEL.md — Store Integration](CENTER_PANEL.md#store-integration) for the fileStore additions
- Most section components are currently placeholders — see Sub-Specifications table for implementation status

## Sub-Specifications

Each mode and complex section should have its own detailed sub-spec when implemented:

| Sub-spec | Scope | Status |
|----------|-------|--------|
| Spec Context Mode | Sections, data flow, interactions for spec mode | Planned |
| Agent Context Mode | Sections, live updates, compliance heuristic | Planned |
| Code Context Mode | Sections, file-to-spec mapping | Planned |
| ~~Project Dashboard Mode~~ | ~~Removed — replaced by empty welcome state~~ | N/A |
| Connected Specs (mini graph) | Compact graph rendering, node layout, interactions | Planned |
| Compliance Hints | Heuristic algorithm, requirement extraction, matching | Planned |

## Related Specs

- **Parent:** [WEBVIEW.md](WEBVIEW.md) — overall UI layout
- **Related:** [APP_SHELL.md](APP_SHELL.md) — three-panel layout, panel management
- **Depends on:** [State Management](../src/store/README.md) — reads specStore, sessionStore, fileStore
- **Related:** [GRAPH_INTERACTIONS.md](GRAPH_INTERACTIONS.md) — Connected Specs section uses a mini version of GraphView
- **Related:** [PROGRESS_TRACKER.md](PROGRESS_TRACKER.md) — Dashboard mode overlaps with progress metrics
- **Consumes:** [Spec Module (backend)](../../backend/app/spec/README.md) — spec data, graph, registry
- **Consumes:** [Agent Module (backend)](../../backend/app/agent/README.md) — session events for agent mode
