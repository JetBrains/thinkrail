---
id: theming
type: submodule-design
status: active
title: Theming
parent: webview
covers:
- frontend/src/styles/
tags:
- frontend
- ui
- theme
- css
---
# Theming — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §9 | Status: **Active** | Created: 2026-03-02

## Overview

Bonsai uses a CSS custom property system for theming. The default is a dark theme (JetBrains New UI / Darcula-inspired). A light theme variant is auto-activated via `prefers-color-scheme`. Users can override with an explicit preference.

## Theme Architecture

All colors are defined as CSS custom properties on `:root`. Components reference variables, never hardcode colors.

```css
:root,
[data-theme="dark"] { /* dark theme — default */ }

[data-theme="light"] { /* explicit light overrides */ }

@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) { /* auto light */ }
}
```

### Resolution Order

1. Explicit `data-theme` attribute on `<html>` (set by user preference)
2. `prefers-color-scheme` media query (system default)
3. Fallback: dark theme

## Color Tokens

### Semantic Tokens (used by components)

| Token | Purpose | Dark | Light |
| --- | --- | --- | --- |
| `--bg` | App background | `#1e1f22` | `#f7f8fa` |
| `--panel` | Panel backgrounds | `#2b2d30` | `#ffffff` |
| `--elevated` | Cards, inputs, modals | `#393b40` | `#f0f1f2` |
| `--hover` | Hover state backgrounds | `#43454a` | `#e8e9eb` |
| `--border` | Primary borders | `#43454a` | `#d1d3d8` |
| `--border2` | Secondary borders | `#5a5d63` | `#b4b8bf` |
| `--text` | Primary text | `#dfe1e5` | `#1e1f22` |
| `--muted` | Secondary text | `#a8adb5` | `#5a5d63` |
| `--hint` | Tertiary text, labels | `#6f737a` | `#8c8f96` |
| `--sel` | Selection background | `#2d4f67` | `#d4e4fa` |

### Accent Tokens (consistent across themes)

| Token | Purpose | Value |
| --- | --- | --- |
| `--blue` | Primary accent, links, active | `#6AC8FF` |
| `--green` | Success, done, additions | `#6AD859` |
| `--red` | Error, deletions, danger | `#FF4B75` |
| `--gold` | Warning, pending, approvals | `#FFD54B` |

**Note:** Accent colors are the same in dark and light themes for brand consistency. Their alpha variants (used for backgrounds) adjust automatically since they overlay different base colors.

### Typography Tokens

| Token | Formula | Default (base=13px) |
| --- | --- | --- |
| `--font-base` | set by JS from `.bonsai/settings.json` | `13px` |
| `--compact-font-base` | set by JS from `.bonsai/settings.json` | `9px` |
| `--font-xs` | `calc(--font-base * 0.69)` | `9.0px` |
| `--font-sm` | `calc(--font-base * 0.77)` | `10.0px` |
| `--font-md` | `calc(--font-base * 0.85)` | `11.1px` |
| `--font-lg` | `calc(--font-base * 0.92)` | `12.0px` |
| `--font-body` | `var(--font-base)` | `13.0px` |
| `--font-lg2` | `calc(--font-base * 1.15)` | `15.0px` |
| `--font-xl` | `calc(--font-base * 1.31)` | `17.0px` |
| `--font` | (static) | `"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace` |
| `--line-height` | (static) | `1.6` |

### Spacing Tokens

| Token | Formula | Default (base=13px) |
| --- | --- | --- |
| `--space-xs` | `calc(--font-base * 0.31)` | `4.0px` |
| `--space-sm` | `calc(--font-base * 0.62)` | `8.0px` |
| `--space-md` | `calc(--font-base * 0.92)` | `12.0px` |
| `--space-lg` | `calc(--font-base * 1.23)` | `16.0px` |
| `--space-xl` | `calc(--font-base * 1.85)` | `24.0px` |

### Border Radius Tokens

| Token | Formula | Default (base=13px) |
| --- | --- | --- |
| `--radius-sm` | `calc(--font-base * 0.31)` | `4.0px` |
| `--radius-md` | `calc(--font-base * 0.46)` | `6.0px` |
| `--radius-lg` | `calc(--font-base * 0.62)` | `8.0px` |

### Settings-Driven Font Scale

All font, spacing, and radius tokens derive from `--font-base` via CSS `calc()` ratios. The base value is read from `.bonsai/settings.json` and applied to `:root` by `frontend/src/utils/fontScale.ts`.

**Settings fields:**
- `font_size` (default: 13) — base font size for normal view
- `compact_font_size` (default: 9) — base font size for compact view

**Compact mode:** `.chat-stream--compact` overrides `--font-base: var(--compact-font-base)`, causing all child tokens to recalculate.

**Monaco editors:** Use the `useFontSize(step)` hook from `fontScale.ts` to get computed px values.

**Live reload:** Changes to `.bonsai/settings.json` are detected by the file watcher and pushed to the frontend via `file/didChange` notification, which triggers a settings re-fetch and CSS update.

### Transition Tokens

| Token | Value |
| --- | --- |
| `--transition-fast` | `120ms ease` |
| `--transition-normal` | `200ms ease` |

## Theme Switching

### User Preference Storage

```typescript
type ThemePreference = "dark" | "light" | "system";
```

- Stored in `localStorage` under key `bonsai-theme`
- Default: `"system"` (follows OS preference)
- Applied by setting `data-theme` attribute on `<html>`

### Implementation

```typescript
function applyTheme(preference: ThemePreference): void {
  const html = document.documentElement;
  if (preference === "system") {
    html.removeAttribute("data-theme"); // let media query decide
  } else {
    html.setAttribute("data-theme", preference);
  }
  localStorage.setItem("bonsai-theme", preference);
}

// On app start:
const saved = localStorage.getItem("bonsai-theme") as ThemePreference || "system";
applyTheme(saved);
```

### System Change Listener (Planned)

> **Not yet implemented.** When `prefers-color-scheme` changes and the user preference is `"system"`, the CSS media query handles theme switching automatically. A JS listener to notify non-CSS components (xterm.js, canvas) is planned but not yet built.

## Component-Specific Theme Concerns

### xterm.js (Console)

xterm.js doesn't use CSS variables — it needs explicit color objects. Update the theme object when the app theme changes:

```typescript
function getXtermTheme(): ITheme {
  const isDark = getCurrentTheme() === "dark";
  return isDark ? DARK_XTERM_THEME : LIGHT_XTERM_THEME;
}
```

### SVG Graph Edges

SVG elements use `stroke` attributes. Use `currentColor` or CSS `stroke: var(--border)` where possible. For markers (arrowheads), define both dark and light variants or use `currentColor`.

### Syntax Highlighting (Chat UI code blocks)

Code block syntax themes should switch with the app theme:
- Dark: based on current color palette
- Light: adapted lighter variant

## CSS Structure

```
frontend/src/
  styles/
    tokens.css       # Accent colors + shared tokens (spacing, radii, typography, transitions)
    theme-dark.css   # Dark theme semantic color values (default)
    theme-light.css  # Light theme semantic color values
    global.css       # Imports tokens + base styles
```

## Accessibility

- All text meets WCAG 2.1 AA contrast ratio (4.5:1 for normal text, 3:1 for large text)
- Accent colors on dark backgrounds are pre-validated for contrast
- Light theme uses sufficiently dark text on light backgrounds
- Focus indicators visible in both themes (outline uses `--blue`)

## Future

- Custom theme editor (pick accent colors)
- Import/export theme presets
- High contrast mode for accessibility

## Known Limitations

- **No per-component theme override:** All components use global CSS variables — cannot theme individual panels differently
- **Light theme is approximate:** Light theme colors are specified but not validated against all component states
- **No high contrast mode:** WCAG AAA compliance not guaranteed

## Related Specs

- **Parent:** [Web View](WEBVIEW.md)
- **Depends on:** None (standalone CSS system)
- **Related:** [Console](../src/components/Console/README.md) (xterm.js theme mapping), [Graph Interactions](GRAPH_INTERACTIONS.md) (node colors), [Responsive Behavior](RESPONSIVE_BEHAVIOR.md)
