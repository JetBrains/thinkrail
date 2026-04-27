---
id: responsive-behavior
type: submodule-design
title: Responsive Behavior
parent: webview
covers:
- frontend/src/
tags:
- frontend
- ui
- responsive
- layout
---
# Responsive Behavior — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §9 | Status: **Draft** | Created: 2026-03-02

> **Note:** This spec is mostly a **design document for planned behavior**. Currently implemented: breakpoint detection in `uiStore`, hiding `.header-project`, `.header-sessions`, `.status-right` at `<1024px`. **Not yet implemented:** drawer mode, auto-collapse, panel max widths, collapse/expand animations, per-component responsive rules.

## Overview

Bonsai targets desktop/laptop screens with a minimum viewport width of 1024px. Below that threshold, the three-panel layout gracefully degrades by auto-collapsing side panels. The center panel (sessions) is always visible.

## Breakpoints

| Breakpoint | Width | Layout |
| --- | --- | --- |
| **Desktop** | ≥ 1280px | All three panels visible at default widths |
| **Laptop** | 1024–1279px | All three panels, but narrower defaults |
| **Below minimum** | < 1024px | Side panels auto-collapsed, center-only |

## Panel Behavior by Breakpoint

### Desktop (≥ 1280px)

```
┌──────────┬──────────────────────────┬──────────────────┐
│  LEFT    │  CENTER                  │  RIGHT           │
│  260px   │  flex                    │  380px           │
└──────────┴──────────────────────────┴──────────────────┘
```

- All panels visible
- Default widths: Left 260px, Right 380px, Center fills remaining
- All panels resizable via drag handles
- No auto-collapse

### Laptop (1024–1279px)

```
┌────────┬──────────────────────────┬──────────────┐
│  LEFT  │  CENTER                  │  RIGHT       │
│  200px │  flex                    │  280px       │
└────────┴──────────────────────────┴──────────────┘
```

- All panels visible but with reduced default widths
- Left: 200px default (min 140px)
- Right: 280px default (min 200px)
- Drag handles still work
- If user opens both panels and center becomes < 300px, auto-collapse the left panel

### Below Minimum (< 1024px)

```
┌──────────────────────────────────────────────────┐
│  CENTER (full width)                             │
│  [☰ Left] [Sessions...]              [Right ☰]  │
└──────────────────────────────────────────────────┘
```

- Both side panels auto-collapsed
- Center takes full width
- Toggle buttons in header for Left (`☰`) and Right panels
- When opened, side panels overlay as slide-out drawers (absolute positioned, not pushing center)
- Backdrop behind drawer, click to dismiss

## Resize Constraints

| Panel | Min Width | Max Width | Collapse Threshold |
| --- | --- | --- | --- |
| Left | 140px | 420px | Dragged below 100px → collapses |
| Right | 200px | 600px | Dragged below 150px → collapses |
| Center | 300px | — | Never collapses |

### Snap-to-Collapse

When a user drags a panel resize handle below the collapse threshold:
1. Panel snaps to collapsed (width → 0, hidden)
2. Drag handle becomes a thin expand strip (3px, hover to expand)
3. Click strip or use keyboard shortcut to restore panel

## Auto-Collapse Rules

When the viewport resizes (window resize, not panel drag):
1. Calculate available width: `viewport - left - right`
2. If center would be < 300px:
   - First: collapse left panel
   - If still < 300px: collapse right panel
3. On viewport expand: panels stay collapsed until user manually opens them (don't auto-restore)

## Panel Toggle Transitions

| Transition | Animation | Duration |
| --- | --- | --- |
| Collapse (drag) | Width → 0, content fades | 250ms ease |
| Expand (drag) | Width → default, content fades in | 250ms ease |
| Drawer open (< 1024px) | Slide in from edge + backdrop fade | 200ms ease-out |
| Drawer close (< 1024px) | Slide out + backdrop fade | 150ms ease-in |

## Header Adaptation

At < 1024px, the header adapts:
- Logo text shortens: "🌿 Bonsai" → "🌿"
- Project name hidden
- Session count pill hidden
- Only essential buttons: `☰` (left), `+ New`, `☰` (right)

## Status Bar Adaptation

At < 1024px:
- Keyboard shortcut hints hidden
- Only spec counts remain

## Component-Specific Responsive Rules

### Graph View (Right Panel)

- Below 280px panel width: legend collapses to icon-only mode
- Below 250px: zoom controls move to overlay center-bottom
- Graph nodes use smaller font (10px) and tighter padding

### Progress Tab (Left Panel)

- Below 200px panel width: progress bars hidden, only percentage text shown
- Session tracker cards: truncate session name, hide file chips
- Timeline: hide timestamps, show icons only

### Chat UI (Center Panel)

- Always full-width responsive — no special breakpoints needed
- Message bubbles: max-width adjusts from 90% to 95% at narrow widths
- Tool cards: max-width 100% below 400px center width

## State

These fields are part of the unified `UiStore` interface (not a separate interface):

```typescript
// In uiStore (implemented)
viewportWidth: number;
breakpoint: "desktop" | "laptop" | "below-min";
leftPanelCollapsed: boolean;   // note: "Panel" in field name
rightPanelCollapsed: boolean;

// In uiStore (declared but not yet wired)
leftDrawerOpen: boolean;    // only used at < 1024px (planned)
rightDrawerOpen: boolean;   // only used at < 1024px (planned)
```

## CSS Implementation

```css
/* Laptop adjustments */
@media (max-width: 1279px) {
  #left { width: 200px; }
  #right { width: 280px; }
}

/* Below minimum — drawer mode */
@media (max-width: 1023px) {
  #left, #right {
    position: fixed;
    top: 44px; /* below header */
    bottom: 26px; /* above status bar */
    z-index: 500;
    transform: translateX(-100%); /* left panel */ / translateX(100%); /* right panel */
    transition: transform 0.2s ease-out;
  }
  #left.drawer-open { transform: translateX(0); }
  #right.drawer-open { transform: translateX(0); }

  .drawer-backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,.4);
    z-index: 499;
  }
}
```

## Accessibility

> **Modifier key:** Mod = Ctrl on macOS, Alt on Linux/Windows

- Collapsed panels remain accessible via keyboard shortcuts (`Mod+B`, `Mod+J`)
- Drawer mode traps focus within the open drawer
- Escape closes the active drawer
- Screen readers announce panel state changes

## Known Limitations

- **No mobile support:** Minimum 1024px viewport — phones and small tablets are not supported
- **No touch gestures:** Panel resize is mouse-only — no swipe gestures for drawer open/close
- **No orientation handling:** Landscape/portrait switching not addressed

## Related Specs

- **Parent:** [Web View](WEBVIEW.md)
- **Depends on:** [State Management](../src/store/README.md) (uiStore panel state)
- **Related:** [App Shell](APP_SHELL.md) (panel layout), [Theming](THEMING.md) (CSS media queries)
