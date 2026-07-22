---
id: task-collapsible-panels
type: task-spec
status: done
title: Collapsible left/right panels + toggles; move open-project to the PROJECTS row
parent: submodule-web-shell
---

# Collapsible left/right panels + toggles; move open-project button

## Request

- Left-panel collapse toggle (`panel-left` icon) in the top-right of the left panel's 48px top bar;
  collapsing gives the space to the center.
- Move the open-project trigger (folder-open) out of that corner onto the **PROJECTS** label row,
  right-aligned; behavior/dropdown unchanged.
- Right-rail collapse toggle (`panel-right` icon) at the right end of the right rail's 48px tab strip,
  **after** the refresh button (order: refresh, then panel-right = rightmost); collapsing gives the
  space to the center.
- A collapsed panel hides its content but its toggle stays reachable to re-expand. Collapse state is
  client-only view state (localStorage). Existing icons/styles only; no other changes.

## Design

- **State (`store` + `store/panelLayoutStorage.ts`):** `panelCollapsed: { left: boolean; right: boolean }`
  (init from localStorage `thinkrail:panelCollapsed`, default both false) + `togglePanel(side)` which
  flips + persists. Client-only; never sent to the server.
- **`Shell` layout:** the two prior branches (active vs welcome) unify into one collapse-aware flex row:
  a fixed-width **`CollapsedRail`** (a 48px top holding the re-expand toggle, over an empty body) is
  rendered beside a `ResizablePanelGroup` when a side is collapsed; the collapsed side's `ResizablePanel`
  (+ its handle) is omitted from the group so the center flexes into the freed space. The center panel
  keeps its slot/identity across toggles, so `CenterTabs`/terminals/editor **don't remount**. Right rail
  + its collapse only exist with an active workspace; the center body branches
  `CenterTabs` vs `WelcomePanel` inside one shared center panel. `resize-left`/`resize-right` render only
  when their side is expanded.
- **Toggles (existing button styling, `lucide` `PanelLeft`/`PanelRight`, testids `toggle-left-panel` /
  `toggle-right-panel`, English aria/labels):** expanded → in `LeftPanel`'s top-bar right corner and at
  the right end of `RightPanel`'s tab strip; collapsed → in the `CollapsedRail`. Same testid in both
  states (only one exists at a time).
- **Open-project move:** `AddProjectMenu` (folder-open, `add-project-menu`) + `useOpenProject` + its
  `dialogs` move from `LeftPanel`'s top bar to `ProjectTree`'s **PROJECTS** label row (right-aligned).
  `LeftPanel`'s top bar now holds the logo + the panel-left toggle. `add-project-menu`/`menu-open-project`
  testids + the dropdown are unchanged (e2e + fixtures keep working).
- **RightPanel:** the right-end controls move into one `ml-auto` flex group: the (conditional) refresh
  button then the always-present panel-right toggle (rightmost), so they sit adjacent + aligned.

## Constraints honored

Collapse is client-only localStorage view state (no wire); only the two toggles + the open-project
button position + collapse/expand logic change; composer/messages/terminal contents untouched; existing
tokens/icons/styles only.
