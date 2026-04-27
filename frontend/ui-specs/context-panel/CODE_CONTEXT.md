---
id: ui-context-panel-code-mode
type: submodule-design
title: Code Context Sections Design
parent: ui-context-panel
covers:
- frontend/src/components/ContextPanel/modes/CodeContext.tsx
- frontend/src/components/ContextPanel/sections/CoveringSpecs.tsx
- frontend/src/components/ContextPanel/sections/RelatedTasks.tsx
tags:
- frontend
- ui-spec
---
# Code Context Sections — Sub-Module Design

> Parent: [CONTEXT_PANEL.md](../CONTEXT_PANEL.md) | Status: **Draft** | Created: 2026-03-06

## Overview

The Code Context mode activates when a non-spec file is open or previewed in the center panel. It renders 2 collapsible sections showing specs and tasks related to the focused file.

**Files:** `frontend/src/components/ContextPanel/modes/CodeContext.tsx` and `sections/{CoveringSpecs,RelatedTasks}.tsx`

---

## Sections — All TODO

Both sections are currently placeholders. Algorithms and rendering TBD.

### 1. CoveringSpecs — TODO

**Purpose:** Show specs whose `covers[]` patterns match the focused file path.

**Planned approach:** Prefix-match focused file against `specStore.specs[].covers[]` patterns. Show matching specs as clickable list.

**Current rendering:** Placeholder — *"Specs covering this file will appear here"*

### 2. RelatedTasks — TODO

**Purpose:** Show task specs related to the focused file via covering specs.

**Planned approach:** From covering specs found above, traverse `graph.edges` to find task-specs that `implements` any covering spec.

**Current rendering:** Placeholder — *"Tasks related to this file will appear here"*

---

## Shared Utilities

When implemented, Code Context sections will reuse:
- `fileMatchesCovers()` from `utils.ts` (defined in Agent Context spec)
- `StatusBadge` from `utils.ts` (defined in Spec Context spec)

---

## File Layout

| File | Responsibility | Status |
|---|---|---|
| `modes/CodeContext.tsx` | Composes 2 sections | Done |
| `sections/CoveringSpecs.tsx` | Specs matching file | Placeholder |
| `sections/RelatedTasks.tsx` | Tasks via covering specs | Placeholder |

---

## Dependencies

- **Parent spec:** [CONTEXT_PANEL.md](../CONTEXT_PANEL.md)
- **Sibling specs:** [SPEC_CONTEXT.md](SPEC_CONTEXT.md), [AGENT_CONTEXT.md](AGENT_CONTEXT.md)
- **Stores:** `specStore` (specs, graph), `fileStore` (activeFilePath, previewFilePath)
