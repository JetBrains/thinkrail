---
id: task-terminal-tabbar-collapse
type: task-spec
status: done
title: Terminal tab bar redesign (underline tabs), padding, and downward collapse
parent: submodule-web-panels
---

# Terminal tab bar redesign (underline tabs), padding, and downward collapse

## Request

Match the reference terminal tab bar (minus its Setup/Run tabs): horizontal tabs with the active one
underlined, "+" right after the last tab, a collapse chevron far-left, background/history far-right;
remove the "TERMINAL" label; add comfortable/balanced body padding; keep the bottom branch label.

## Change

- **`TerminalsPanel`:** dropped the uppercase "TERMINAL" title. New `h-8 items-stretch` tab bar: far-left
  **collapse chevron** (`toggle-terminal-panel` → `togglePanel("terminal")`), then the tabs — active
  marked with an **accent underline** (`border-b-2 border-primary`, full-height so it sits on the bar
  baseline; inactive `border-transparent`) — with **"+"** (tooltip "Add new terminal") **immediately
  after the last tab**, and the **background/history** control (`History`) pinned **far right** (disabled
  when nothing is backgrounded, else the reattach `DropdownMenu`). Body now has balanced padding
  (`px-sm pt-sm`) via a padded wrapper around a `relative` box (so the absolute `TerminalInstance`s inset).
  Branch label unchanged. No-close-last / detach-on-close unchanged.
- **Downward collapse (same pattern as the side panels):** `panelLayoutStorage.PanelCollapsed` gains
  `terminal`; `togglePanel` accepts `"terminal"`. In the worktree right rail the shell wraps the vertical
  group in a flex col; when collapsed it **omits** the terminal `ResizablePanel` (+ handle) so files take
  the height, and renders a thin `terminal-collapsed` bar with a `ChevronUp` re-expand (mirrors
  `CollapsedRail`).

## Verification

- lint + typecheck + check:deps green; `terminals` specs green (+ a new collapse/re-expand test);
  `project-view`/`welcome` (terminal-panel absent in project/welcome) unaffected.
- Screenshot confirmed the reference-style bar (chevron · Terminal 1 · Terminal 2 (underlined) · + …
  History), the inset/padded body, and the branch label.
