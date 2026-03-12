# Context Panel — UI Specification

> Parent: [WEBVIEW.md](WEBVIEW.md) | Status: **Active** | Created: 2026-03-04 | Updated: 2026-03-12

## Overview

The Context Panel is a context-aware sidebar (the right panel in the three-panel layout) that displays information related to the active content in the center panel. It auto-switches between three modes — **Spec Context**, **Agent Context**, and **Code Context** — depending on what the user is working on. When nothing is selected, the panel shows an empty welcome state.

The panel has **no tabs** for mode switching — content auto-switches based on what is in the center panel. A small mode indicator at the top shows the current mode (emoji icon + uppercase label). The header also contains a **Dashboard pin button** (📊) that overrides the auto mode to show the VizTab dashboard. Below the header, each mode renders a vertical stack of collapsible sections.

**Agent Context** shows context usage analytics (token utilization, turn history, tool costs, file I/O, cache stats) for the active session. **Spec Context** and **Code Context** show spec-related information.

---

## Component Hierarchy

```
AppShell
└── ContextPanel                  (ContextPanel.tsx)
    ├── .context-panel__header    (always rendered; icon + label hidden when mode == "empty")
    │   ├── .context-panel__mode-icon   (conditional: shown when pin != "none" || mode != "empty")
    │   ├── .context-panel__mode-label  (conditional: same)
    │   └── .context-panel__dash-btn    (📊 dashboard pin — always visible)
    └── .context-panel__body
        ├── SpecContext            (modes/SpecContext.tsx)
        │   ├── ConnectedSpecs    (sections/ConnectedSpecs.tsx)
        │   ├── LinkedTasks       (sections/LinkedTasks.tsx)
        │   ├── CoveredFiles      (sections/CoveredFiles.tsx)
        │   └── SpecHealth        (sections/SpecHealth.tsx)
        ├── AgentContext           (modes/AgentContext.tsx + AgentContext.css)
        │   ├── UtilizationHeader (inline — always visible)
        │   ├── TokenBreakdown    (CollapsibleSection)
        │   ├── TurnHistory       (CollapsibleSection)
        │   ├── ToolCalls         (CollapsibleSection)
        │   ├── FilesAccessed     (CollapsibleSection)
        │   └── CacheStats        (CollapsibleSection)
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

See [SPEC_CONTEXT.md](context-panel/SPEC_CONTEXT.md) for section details.

### 2. Agent Context (Context Usage Analytics)

**Trigger:** `activeSessionId` is non-null and no file/preview focused.

Renders a metrics dashboard: utilization header, token breakdown, turn history, tool calls, files accessed, and cache stats — all sourced from `session.metrics.contextUsage`.

See [AGENT_CONTEXT.md](context-panel/AGENT_CONTEXT.md) for section details.

### 3. Code Context

**Trigger:** A non-spec file is open/previewed.

See [CODE_CONTEXT.md](context-panel/CODE_CONTEXT.md) for section details.

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

- Expand/collapse state managed via `useState(defaultExpanded)` — resets on remount
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

### Spec & Code Context Sections

All in `frontend/src/components/ContextPanel/sections/`. Placeholder sections render `<div className="section-placeholder">` with static italic hint text.

| Component | Mode | Section Title | Hint Text |
|---|---|---|---|
| `ConnectedSpecs` | spec | Connected Specs | *(renders `<GraphView />` at 280px)* |
| `LinkedTasks` | spec | Tasks | "Tasks linked to this spec will appear here" |
| `CoveredFiles` | spec | Covered Files | "Files covered by this spec will appear here" |
| `SpecHealth` | spec, code | Spec Health | "Spec health summary will appear here" |
| `CoveringSpecs` | code | Covering Specs | "Specs covering this file will appear here" |
| `RelatedTasks` | code | Related Tasks | "Tasks related to this file will appear here" |

### Agent Context Sections

All defined inline in `modes/AgentContext.tsx` (not separate files). Uses `session.metrics.contextUsage` data.

| Component | Section Title | Content |
|---|---|---|
| *(header)* | — | Utilization % bar (always visible, not collapsible) |
| `TokenBreakdown` | Token Breakdown | Stacked bar + 4-row legend (input, cache read, cache creation, output) |
| `TurnHistory` | Turn History | Grid table of turns with run separators |
| `ToolCalls` | Tool Calls | Grid table sorted by token cost |
| `FilesAccessed` | Files Accessed | Read/Written file lists with click-to-preview |
| `CacheStats` | Cache Stats | Hit rate bar + breakdown |

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

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

- `uiStore.rightPanelCollapsed` controls visibility
- Collapsed: 20px-wide button with `◀` and tooltip "Open context panel (Mod+J)"
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

- **Spec/Code sections are placeholders** — only `ConnectedSpecs` has real content (full GraphView)
- **ConnectedSpecs shows full graph** — not filtered to spec neighborhood
- **`expandToCenter` is a no-op** — TODO stubs on ConnectedSpecs
- **Agent context is metrics-only** — no spec/task context in agent mode (by design)
- **Dashboard pin is the only override** — no manual mode switching beyond the 📊 button

---

## Related Specs

- **Parent:** [WEBVIEW.md](WEBVIEW.md)
- **Related:** [APP_SHELL.md](APP_SHELL.md) (panel management), [GRAPH_INTERACTIONS.md](GRAPH_INTERACTIONS.md) (ConnectedSpecs uses GraphView)
- **Depends on:** [State Management](../src/store/README.md) (specStore, sessionStore, fileStore, uiStore)
