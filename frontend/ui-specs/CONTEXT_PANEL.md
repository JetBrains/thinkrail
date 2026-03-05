# Context Panel — UI Specification

> Parent: [WEBVIEW.md](WEBVIEW.md) | Status: **Active** | Created: 2026-03-04 | Updated: 2026-03-05

## Overview

The Context Panel is a context-aware sidebar (the right panel in the three-panel layout) that displays information related to the active content in the center panel. It auto-switches between three modes — **Spec Context**, **Agent Context**, and **Code Context** — showing connected specs, linked tasks, and covered files depending on what the user is working on. When nothing is selected, the panel shows an empty welcome state.

The panel has **no tabs**. Content auto-switches based on what is in the center panel. A small mode indicator at the top shows the current mode (emoji icon + uppercase label). Below it, each mode renders a vertical stack of collapsible sections.

---

## Component Hierarchy

```
AppShell
└── ContextPanel                  (ContextPanel.tsx)
    ├── .context-panel__header    (hidden when mode == "empty")
    │   ├── .context-panel__mode-icon
    │   └── .context-panel__mode-label
    └── .context-panel__body
        ├── SpecContext            (modes/SpecContext.tsx)
        │   ├── ConnectedSpecs    (sections/ConnectedSpecs.tsx)
        │   ├── LinkedTasks       (sections/LinkedTasks.tsx)
        │   ├── CoveredFiles      (sections/CoveredFiles.tsx)
        │   └── SpecHealth        (sections/SpecHealth.tsx)
        ├── AgentContext           (modes/AgentContext.tsx)
        │   ├── TaskSpecPreview   (sections/TaskSpecPreview.tsx)
        │   ├── FilesModified     (sections/FilesModified.tsx)
        │   ├── RelatedSpecs      (sections/RelatedSpecs.tsx)
        │   └── ComplianceHints   (sections/ComplianceHints.tsx)
        ├── CodeContext            (modes/CodeContext.tsx)
        │   ├── CoveringSpecs     (sections/CoveringSpecs.tsx)
        │   ├── RelatedTasks      (sections/RelatedTasks.tsx)
        │   └── SpecHealth        (sections/SpecHealth.tsx)
        └── <div.context-panel__empty>
```

All files under `frontend/src/components/ContextPanel/`.

---

## Context Modes

### Mode Indicator

| Mode | Icon | Label |
|---|---|---|
| `spec` | 📋 | Spec Context |
| `agent` | 🤖 | Agent Context |
| `code` | 📁 | Code Context |
| `empty` | *(header hidden)* | |

### 1. Spec Context

**Trigger:** A spec file is open/previewed, or `selectedSpecId` is set with no file open.

| Section | Component | Status |
|---|---|---|
| Connected Specs | `ConnectedSpecs` | Partial — renders full `<GraphView />` at 280px height; no subgraph filtering |
| Tasks | `LinkedTasks` | Placeholder |
| Covered Files | `CoveredFiles` | Placeholder |
| Spec Health | `SpecHealth` | Placeholder (`defaultExpanded={false}`) |

### 2. Agent Context

**Trigger:** `activeSessionId` is non-null and no file/preview focused.

| Section | Component | Status |
|---|---|---|
| Task Spec | `TaskSpecPreview` | Placeholder (has `expandToCenter` stub) |
| Files Modified | `FilesModified` | Placeholder |
| Related Specs | `RelatedSpecs` | Placeholder |
| Compliance | `ComplianceHints` | Placeholder |

### 3. Code Context

**Trigger:** A non-spec file is open/previewed.

| Section | Component | Status |
|---|---|---|
| Covering Specs | `CoveringSpecs` | Placeholder |
| Related Tasks | `RelatedTasks` | Placeholder |
| Spec Health | `SpecHealth` | Placeholder (`defaultExpanded={false}`) |

### 4. Empty State

**Trigger:** No file, no preview, no active session, no `selectedSpecId`.

Renders: *"Select a file, spec, or agent session to see context."* in `.context-panel__empty`.

---

## CollapsibleSection

**File:** `CollapsibleSection.tsx`

### Props

```typescript
interface CollapsibleSectionProps {
  title: string;
  count?: number;
  defaultExpanded?: boolean;    // default: true
  expandToCenter?: () => void;  // shows ⇱ button if provided
  summary?: React.ReactNode;    // shown when collapsed
  children: React.ReactNode;
}
```

### Behavior

- Expand/collapse state persisted to `localStorage` key `bonsai-section-{title}`
- Collapse animation via `max-height` CSS transition (0 ↔ 2000px)
- Chevron: `▼` expanded, `▶` collapsed
- `expandToCenter` button renders `⇱` with `stopPropagation`

### DOM Structure

```
.collapsible-section [.collapsible-section--expanded]
  button.collapsible-section__header
    span.collapsible-section__chevron
    span.collapsible-section__title
    span.collapsible-section__count
    span.collapsible-section__summary
    span.collapsible-section__expand
  div.collapsible-section__body [.collapsible-section__body--open]
    div.collapsible-section__content
```

---

## Section Components

All in `frontend/src/components/ContextPanel/sections/`. All placeholder sections render `<div className="section-placeholder">` with static italic hint text.

| Component | Section Title | Hint Text |
|---|---|---|
| `ConnectedSpecs` | Connected Specs | *(renders `<GraphView />` at 280px)* |
| `LinkedTasks` | Tasks | "Tasks linked to this spec will appear here" |
| `CoveredFiles` | Covered Files | "Files covered by this spec will appear here" |
| `SpecHealth` | Spec Health | "Spec health summary will appear here" |
| `TaskSpecPreview` | Task Spec | "Task spec driving this session will appear here" |
| `FilesModified` | Files Modified | "Files modified by agent will appear here" |
| `RelatedSpecs` | Related Specs | "Specs related to this session will appear here" |
| `ComplianceHints` | Compliance | "Compliance tracking will appear here" |
| `CoveringSpecs` | Covering Specs | "Specs covering this file will appear here" |
| `RelatedTasks` | Related Tasks | "Tasks related to this file will appear here" |

---

## Mode Derivation

**File:** `useContextMode.ts`

```typescript
export type ContextMode = "spec" | "agent" | "code" | "empty";

export function useContextMode(): ContextMode {
  const focusedFile = previewFilePath ?? activeFilePath;
  if (focusedFile) return isSpecFile(focusedFile) ? "spec" : "code";
  if (activeSessionId) return "agent";
  if (selectedSpecId) return "spec";
  return "empty";
}
```

**Priority:** file/preview > active session > selected spec > empty.

`isSpecFile(path)` checks `/.specs/` prefix and matches against `specStore.specs` paths.

---

## Panel Toggle

- `uiStore.rightPanelCollapsed` controls visibility
- Collapsed: 20px-wide button with `◀` and tooltip "Open context panel (Cmd+J)"
- Expanded: `ResizeHandle` for drag-to-resize
- Default width: 380px, minimum 200px, collapse threshold 150px

---

## State Management

| Store | Fields | Purpose |
|---|---|---|
| `fileStore` | `activeFilePath`, `previewFilePath` | Mode derivation |
| `sessionStore` | `activeSessionId` | Agent context trigger |
| `specStore` | `selectedSpecId`, `specs`, `graph` | Spec detection, graph rendering |
| `uiStore` | `rightPanelCollapsed` | Panel visibility |

---

## CSS Classes

### ContextPanel.css

| Class | Description |
|---|---|
| `.context-panel` | Root (flex column, full height) |
| `.context-panel__header` | Mode header bar (hidden when empty) |
| `.context-panel__mode-icon` | Emoji icon (12px) |
| `.context-panel__mode-label` | Mode label (11px, uppercase, 600 weight) |
| `.context-panel__body` | Content area (flex 1, overflow-y auto) |
| `.context-panel__empty` | Empty state (italic hint text, centered) |
| `.section-placeholder` | Placeholder text (italic, hint color, centered) |

### CollapsibleSection.css

| Class | Description |
|---|---|
| `.collapsible-section` | Section root (border-bottom) |
| `.collapsible-section--expanded` | Expanded modifier |
| `.collapsible-section__header` | Header button (11px, uppercase, 600) |
| `.collapsible-section__chevron` | Triangle (8px, muted) |
| `.collapsible-section__title` | Title text (flex 1) |
| `.collapsible-section__count` | Count badge (10px, elevated bg) |
| `.collapsible-section__summary` | Collapsed summary (10px, hint) |
| `.collapsible-section__expand` | Peek button ⇱ (12px, hint → blue on hover) |
| `.collapsible-section__body` | Collapse wrapper (max-height transition) |
| `.collapsible-section__body--open` | Open state (max-height 2000px) |
| `.collapsible-section__content` | Inner padding wrapper |

---

## Known Limitations

- **Most sections are placeholders** — only `ConnectedSpecs` has real content (full GraphView)
- **ConnectedSpecs shows full graph** — not filtered to spec neighborhood
- **`expandToCenter` is a no-op** — TODO stubs on ConnectedSpecs and TaskSpecPreview
- **No props passed to sections** — no data fetching implemented in any section
- **No manual mode override** — always follows center panel state

---

## Related Specs

- **Parent:** [WEBVIEW.md](WEBVIEW.md)
- **Related:** [APP_SHELL.md](APP_SHELL.md) (panel management), [GRAPH_INTERACTIONS.md](GRAPH_INTERACTIONS.md) (ConnectedSpecs uses GraphView)
- **Depends on:** [State Management](../src/store/README.md) (specStore, sessionStore, fileStore, uiStore)
