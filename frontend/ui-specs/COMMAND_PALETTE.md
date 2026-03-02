# Command Palette — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §6 | Status: **Active** | Created: 2026-03-02

## Overview

A floating search modal (`Cmd+K`) for quick navigation across specs, files, sessions, and actions. Supports prefix modes for filtered search.

## Component Hierarchy

```
<PaletteOverlay>                     // fixed backdrop
  <PaletteContainer>                 // centered card
    <PaletteInput />                 // search input with mode indicator
    <PaletteResults>                 // scrollable result list
      <PaletteGroup>                 // category header
        <PaletteItem /> ...          // individual results
      </PaletteGroup>
    </PaletteResults>
    <PaletteFooter />                // keyboard hints
  </PaletteContainer>
</PaletteOverlay>
```

## Prefix Modes

| Prefix | Mode | Searches | Example |
| --- | --- | --- | --- |
| (none) | All | Everything — specs, sessions, files, actions | `spec mod` |
| `/` | Actions | Skills and built-in actions only | `/module-design` |
| `#` | Specs | Specs by title, type, tags | `#Core Module` |
| `@` | Sessions | Active and archived sessions by name | `@architecture` |

- Prefix is typed by the user in the input field
- A mode badge appears next to the input when a prefix is active (e.g., `/ Actions`)
- Backspacing past the prefix clears it and returns to "All" mode

## Search Algorithm

**Fuzzy matching** — substring match with scoring:

1. Exact prefix match scores highest
2. Word-boundary match (e.g., "sm" matches "**S**pec **M**odule") scores high
3. Substring match scores lower
4. Results sorted by score, then by recency (recently accessed items first)

**Data sources:**
- Specs: cached from `spec/list` RPC
- Sessions: from client-side session store (active + archived)
- Files: fetched lazily from backend (or cached from spec `covers` fields)
- Actions: hardcoded registry of built-in actions

## Result Categories

| Category | Icon | Badge | Action on Select |
| --- | --- | --- | --- |
| **Specs** | Type emoji | `spec` | Select spec → update right panel |
| **Sessions** | `●` / `✓` | `session` | Switch to session tab |
| **Files** | `📄` | `file` | Open in Code view |
| **Actions** | `✨` / `⚙` | `action` | Execute (e.g., new session, toggle panel) |

### Built-in Actions

| Action | Description |
| --- | --- |
| New session | Open new session modal |
| Toggle left panel | Show/hide left panel |
| Toggle right panel | Show/hide right panel |
| Fit graph to view | Reset graph zoom/pan |
| Refresh specs | Re-fetch spec data |

## Layout

```
┌──────────────────────────────────────────────┐
│  🔍 Search specs, files, sessions, actions...│
│──────────────────────────────────────────────│
│  SPECS                                       │
│  📦 Spec Module                        spec  │
│  📦 Core Module                        spec  │
│──────────────────────────────────────────────│
│  SESSIONS                                    │
│  ● module-design                    session  │
│──────────────────────────────────────────────│
│  ACTIONS                                     │
│  ✨ New session                      action  │
│──────────────────────────────────────────────│
│  ↑↓ navigate  ↵ select  esc dismiss         │
└──────────────────────────────────────────────┘
```

- Width: 520px (max 96vw)
- Max results height: 300px (scrollable)
- Results grouped by category with section headers
- Empty query → show recent items (last 5 accessed specs/sessions)
- No results → show "No matches" message

## Keyboard Navigation

| Key | Action |
| --- | --- |
| `Cmd+K` | Open palette (global) |
| `Escape` | Close palette |
| `↑` / `↓` | Move selection through results |
| `Enter` | Execute selected result |
| `Tab` | Cycle through prefix modes (none → `/` → `#` → `@` → none) |

- Active item has `--sel` background highlight
- Selection wraps around (bottom → top)

## State

```typescript
interface PaletteState {
  isOpen: boolean;
  query: string;
  mode: "all" | "actions" | "specs" | "sessions";
  activeIndex: number;
  results: PaletteItem[];
  recentItems: PaletteItem[];
}
```

## Animation

- Open: overlay fade in (180ms), container scale 0.97→1.0 + fade (200ms)
- Close: reverse (150ms)
- Result items: no entrance animation (instant render on type)

## CSS Classes

| Class | Element |
| --- | --- |
| `#palette-overlay` | Backdrop |
| `#palette` | Container card |
| `#palette-input` | Search input |
| `.pal-mode-badge` | Prefix mode indicator |
| `.pal-results` | Results container |
| `.pal-group` | Category section |
| `.pal-group-header` | Category label |
| `.pal-item` | Result item |
| `.pal-item.active` | Keyboard-selected item |
| `.pal-icon` | Item icon |
| `.pal-label` | Item text |
| `.pal-type` | Category badge |
| `.pal-footer` | Keyboard hints |
| `.pal-empty` | No results message |

## Known Limitations

- **No file content search:** Searches file paths only, not file contents (would require backend full-text search API)
- **No custom actions:** Action registry is hardcoded — no user-defined or plugin-defined actions in v1
- **No search history:** Previous searches are not remembered across sessions

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §6
- **Depends on:** [API Client](../src/api/README.md) (spec/list for spec search), [State Management](../src/store/README.md) (session list)
- **Related:** [New Session Modal](NEW_SESSION_MODAL.md) (action: "New session")
