# Command Palette — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §6 | Status: **Active** | Created: 2026-03-02

## Overview

A floating search modal (`Mod+K`) for quick navigation across specs, sessions, and actions. Supports prefix modes for filtered search.

**Modifier key:** `Mod` = Ctrl on macOS, Alt on Linux/Windows.

## Component Hierarchy

The palette is a single `CommandPalette` component (`CommandPalette.tsx`) using plain `div` and `button` elements — there are no sub-components.

```
<div.palette-backdrop>                  // fixed backdrop, click to dismiss
  <div.palette-container>               // centered card
    <input.palette-input />             // search input (no mode badge)
    <div.palette-results>               // scrollable result list
      <div.palette-empty />             // shown when no results
      <button.palette-item /> ...       // flat list of results (no grouping)
    </div.palette-results>
    <div.palette-footer />              // keyboard hints
  </div.palette-container>
</div.palette-backdrop>
```

## Prefix Modes

| Prefix | Mode | Searches | Example |
| --- | --- | --- | --- |
| (none) | All | Everything — specs, sessions, actions | `spec mod` |
| `/` | Actions | Built-in actions only | `/new` |
| `#` | Specs | Specs by title | `#Core Module` |
| `@` | Sessions | Active sessions by name | `@architecture` |

- Prefix is typed by the user in the input field
- Backspacing past the prefix clears it and returns to "All" mode
- Tab cycles through prefix modes in order: none -> `#` -> `@` -> `/` -> none (replaces entire query with just the prefix character)
- **Planned:** A mode badge next to the input when a prefix is active (e.g., `/ Actions`) — not yet implemented

## Search Algorithm

**Simple substring matching** with two-tier scoring:

1. `startsWith` match scores 3 (highest)
2. `includes` match scores 1 (lower)
3. No match scores 0 (excluded)

All comparisons are case-insensitive. There is no word-boundary matching.

Results are **not sorted by score**. They appear in category order: specs first, then sessions, then actions. Within each category, items appear in their source-data order.

When the query is empty, all items are returned (score defaults to 1 for empty query).

**Data sources:**
- Specs: from `useSpecStore` (all loaded specs, matched by `title`)
- Sessions: from `useSessionStore` (all sessions in the `sessions` Map, matched by `name`)
- Actions: hardcoded array inside the component (currently only "New session")

## Result Categories

| Category | Badge text | Action on Select |
| --- | --- | --- |
| **Specs** | `spec` | Select spec via `selectSpec()` and close palette |
| **Sessions** | `session` | Switch session via `switchSession()` and close palette |
| **Actions** | `action` | Execute action (e.g., open new session modal) and close palette |

There is no "file" category.

Results are displayed as a **flat list** with a badge on each item indicating its category. There are no category group headers or section dividers.

### Built-in Actions

| Action | Description | Status |
| --- | --- | --- |
| New session | Open new session modal via `openModal()` | Implemented |
| Toggle left panel | Show/hide left panel | **Planned** |
| Toggle right panel | Show/hide right panel | **Planned** |
| Fit graph to view | Reset graph zoom/pan | **Planned** |
| Refresh specs | Re-fetch spec data | **Planned** |

## Layout

```
┌──────────────────────────────────────────┐
│  Search specs, sessions, actions... (# @ /)│
│──────────────────────────────────────────│
│  Spec Module                        spec │
│  Core Module                        spec │
│  module-design                   session │
│  New session                      action │
│──────────────────────────────────────────│
│  ↑↓ navigate  ↵ select  Tab mode  Esc close│
└──────────────────────────────────────────┘
```

- Width: **480px** (no max-width clamp); max-height: 400px
- Results area: `flex: 1; overflow-y: auto`
- Results are a flat list with per-item badges — no category group headers
- Empty query shows **all items** (not recent items)
- No results shows "No results" message in `.palette-empty`

## Keyboard Navigation

| Key | Action |
| --- | --- |
| `Mod+K` | Toggle palette (global) |
| `Escape` | Close palette |
| `ArrowUp` / `ArrowDown` | Move selection through results |
| `Enter` | Execute selected result |
| `Tab` | Cycle through prefix modes (none -> `#` -> `@` -> `/` -> none) |

- Active (keyboard-selected) item has `var(--hover)` background highlight (same as mouse hover)
- Selection **clamps at boundaries** — does not wrap around (ArrowUp at top stays at 0, ArrowDown at bottom stays at last index)
- `onMouseEnter` on any item updates the selected index to that item

## State

Palette open/close state lives in `useUiStore` (Zustand, persisted):

```typescript
// In useUiStore
paletteOpen: boolean;
togglePalette: () => void;
```

All other state is local to the `CommandPalette` component via `useState` / `useMemo`:

```typescript
const [query, setQuery] = useState("");            // raw input text
const [selectedIndex, setSelectedIndex] = useState(0); // keyboard selection

// Derived via useMemo:
const { mode, cleanQuery } = detectMode(query);    // prefix mode + stripped query
const items: PaletteItem[] = /* filtered/scored list */;
```

The `PaletteItem` interface is defined locally in the component file:

```typescript
interface PaletteItem {
  id: string;
  title: string;
  category: "spec" | "session" | "action";
  action: () => void;
}
```

On open, `query` resets to `""` and `selectedIndex` resets to `0`, and the input is focused via a `setTimeout(..., 0)` ref focus.

## Animation

**Planned** — no animations are currently implemented. The palette renders/unmounts instantly (returns `null` when `!open`).

Planned animations (not yet built):
- Open: overlay fade in (180ms), container scale 0.97 -> 1.0 + fade (200ms)
- Close: reverse (150ms)

## CSS Classes

| Class | Element |
| --- | --- |
| `.palette-backdrop` | Fixed backdrop overlay |
| `.palette-container` | Centered card |
| `.palette-input` | Search input field |
| `.palette-results` | Scrollable results container |
| `.palette-item` | Individual result button |
| `.palette-item-selected` | Keyboard-selected item (additional class) |
| `.palette-item-title` | Item label text |
| `.palette-item-badge` | Category badge (right-aligned) |
| `.palette-footer` | Keyboard hint bar |
| `.palette-empty` | "No results" message |

## Known Limitations

- **No file search:** There is no "file" category — only specs, sessions, and actions
- **No score-based sorting:** Results appear in category order (specs, sessions, actions), not by match quality
- **No result grouping:** Items are a flat list with badges, not grouped under category headers
- **Single built-in action:** Only "New session" is implemented; other actions are planned
- **No recent items:** Empty query shows all items, not a curated recent-items list
- **No custom actions:** Action registry is hardcoded — no user-defined or plugin-defined actions
- **No search history:** Previous searches are not remembered across sessions
- **No mode badge:** No visual indicator in the input for the active prefix mode

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §6
- **Depends on:** [API Client](../src/api/README.md) (spec data via specStore), [State Management](../src/store/README.md) (session list, palette open state)
- **Related:** [New Session Modal](NEW_SESSION_MODAL.md) (action: "New session")
