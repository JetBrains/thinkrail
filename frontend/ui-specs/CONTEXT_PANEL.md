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

The Context Panel is a context-aware sidebar (the right panel in the three-panel layout) that displays information related to the active content in the center panel. It auto-switches between four modes — **Spec Context**, **Agent Context**, **Code Context**, and **Project Dashboard** — showing connected specs, linked tasks, covered files, and project health depending on what the user is working on.

**Replaces:** The previous tab-based right panel (`Graph | Spec | Code | Diff | Console`). Console is removed from the UI for now. Rich views (graphs, full spec text) show compact previews in the sidebar with a "peek-to-center" expand button `[⇱]` to open the full view in the center panel.

## Overview

```
┌──────────┬────────────────────────┬──────────────────────┐
│  LEFT    │      CENTER            │   CONTEXT PANEL      │
│  PANEL   │                        │   (right, 380px)     │
│          │  Spec open?            │→  Spec Context        │
│          │  Agent session?        │→  Agent Context       │
│          │  Code file open?       │→  Code Context        │
│          │  Nothing?              │→  Project Dashboard   │
└──────────┴────────────────────────┴──────────────────────┘
```

The panel has **no tabs**. Content auto-switches based on what's in the center panel. A small **mode indicator** at the top shows the current mode (icon + label, e.g., "📋 Spec Context" or "🤖 Agent Context"). Below it, each mode renders a vertical stack of **collapsible sections** — each section is a self-contained component showing one type of contextual information.

## Context Modes

### 1. Spec Context

**Trigger:** A spec file is open in the center panel, or a spec is selected in the SpecTree.

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

**Trigger:** A non-spec file is open in the center panel.

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

### 4. Project Dashboard

**Trigger:** No file or session is active — the "home" state.

**Sections (top to bottom):**

| Section | Shows | Peek-to-center |
|---------|-------|---------------|
| **Spec Coverage** | Project-wide summary: modules spec'd, task completion %, stale spec count, coverage gaps | No |
| **Open Tasks** | Pending/in-progress tasks grouped by module area | No — click to open |
| **Recent Activity** | Timeline of recent spec changes, completed tasks, agent sessions | No — click to navigate |

```
┌──────────────────────────────┐
│ ▼ Spec Coverage              │
│   Modules:  4/6 spec'd  67%  │
│   Tasks:    28/36 done   78%  │
│   ▃▃▃▃▃▃▃░░░                 │
│   Stale specs: 2             │
├──────────────────────────────┤
│ ▼ Open Tasks (8)             │
│   agent/  ◉2 ○1             │
│   spec/   ◉1 ○2             │
│   rpc/    ○2                 │
├──────────────────────────────┤
│ ▼ Recent Activity            │
│   2m ago  Session completed   │
│   1h ago  Spec updated        │
│   3h ago  Task completed      │
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
| `SpecCoverage` | dashboard | Registry aggregation |
| `OpenTasks` | dashboard | Registry task entries, grouped |
| `RecentActivity` | dashboard | Session history + spec events |

## Mode Derivation

The active mode is derived from existing Zustand stores — no new state required:

```typescript
type ContextMode = 'spec' | 'agent' | 'code' | 'dashboard';

function useContextMode(): ContextMode {
  const activeSession = useSessionStore(s => s.activeSessionId);
  const activeFile = useFileStore(s => s.activeFilePath);
  const selectedSpec = useSpecStore(s => s.selectedSpecId);

  if (activeSession) return 'agent';
  if (activeFile && isSpecFile(activeFile)) return 'spec';
  if (activeFile) return 'code';
  if (selectedSpec) return 'spec';
  return 'dashboard';
}
```

**Priority:** active session > spec file > code file > selected spec > dashboard. An active agent session always takes precedence since it requires the most monitoring.

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

All clickable items (specs, tasks, files) open in the center panel via existing store actions:
- Spec → `specStore.selectSpec(id)` + open file
- Task → `fileStore.openFile(taskPath)`
- File → `fileStore.openFile(filePath)`

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| No tabs, context-driven | Auto-switch based on center panel state | Reduces cognitive load — user doesn't have to manually find relevant info. Linear's peek and Figma's inspector panel validate this pattern. |
| Stacked collapsible sections | Vertically stacked cards, each collapsible | Most common pattern for inspector/properties panels (Figma, Chrome DevTools, JetBrains). Allows scanning multiple info types. User controls density via collapse. |
| Peek-to-center | Compact preview + `[⇱]` expand button for rich content | 380px is too narrow for full graph/spec. Inspired by Linear peek and Notion side peek. |
| Mode from existing stores | `useContextMode()` reads sessionStore + fileStore + specStore | No new state. Single source of truth. Clear priority order. |
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
- Each mode component (`SpecContext`, `AgentContext`, `CodeContext`, `ProjectDashboard`) is a composition of section components
- Section components are independent and reusable — some appear in multiple modes (e.g., `SpecHealth` in both spec and code modes)
- The panel has no fixed max-width — it is dynamically capped by available viewport space (respects center panel's 300px min-width and left panel width)
- When collapsed, a thin `◀` button (`.right-collapse-btn`, 20px wide) remains visible on the right edge, allowing re-expansion without a keyboard shortcut
- The `useContextMode` hook lives in `ContextPanel/useContextMode.ts`, not in a store
- Most section components are currently placeholders — see Sub-Specifications table for implementation status

## Sub-Specifications

Each mode and complex section should have its own detailed sub-spec when implemented:

| Sub-spec | Scope | Status |
|----------|-------|--------|
| Spec Context Mode | Sections, data flow, interactions for spec mode | Planned |
| Agent Context Mode | Sections, live updates, compliance heuristic | Planned |
| Code Context Mode | Sections, file-to-spec mapping | Planned |
| Project Dashboard Mode | Sections, aggregation queries, activity feed | Planned |
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
