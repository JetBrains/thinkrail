---
id: task-terminal-collapse-panel-icon
type: task-spec
status: done
title: Unify the terminal collapse icon with the side-panel toggles (panel-bottom)
parent: submodule-web-panels
---

# Unify the terminal collapse icon with the side-panel toggles (panel-bottom)

## Request

The terminal collapsed via chevrons while the side panels use `PanelLeft`/`PanelRight`. Swap the terminal
collapse/re-expand glyph to `PanelBottom` so all three toggles read as one family — visual/interaction
consistency only. Keep behavior, animations, position, hit area, hover/active/focus states, and tooltips.

## Change (icon glyph only)

- `TerminalsPanel`: the far-left `toggle-terminal-panel` collapse button `ChevronDown` → **`PanelBottom`**
  (`size-4`, `text-muted` — already the side toggles' size/opacity treatment; button classes unchanged).
- `Shell`: the collapsed `terminal-collapsed` re-expand bar `ChevronUp` → **`PanelBottom`** (same icon in
  both states, mirroring how `PanelLeft`/`PanelRight` appear in both the header and the `CollapsedRail`).

No button-style/behavior change: collapse still hides only the bottom panel via `togglePanel("terminal")`;
sessions keep running; re-expand restores them. Tooltips ("Collapse terminal" / "Expand terminal") stay
accurate, so unchanged.

## Verification

- lint + typecheck + check:deps green; the `terminals` collapse/re-expand spec (unchanged `toggle-terminal
  -panel` testid) passes. Screenshots confirmed the `panel-bottom` glyph in both the tab bar and the
  collapsed bar, matching the left/right toggles.
