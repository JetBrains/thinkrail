---
id: submodule-web-search
type: submodule-design
status: active
title: search — the global search palette
parent: module-web
depends-on: [module-contracts]
references: [submodule-web-commands, submodule-web-shell, submodule-web-store]
tags: [ui, search, public-surface-checked]
---

## Responsibility

The one finder: a palette that finds chats, workspaces and projects, runs commands and opens Settings
sections, opened with `Mod+K`, double Shift, or the topbar search button. It owns the presentation,
the query grammar, ranking and learning, and the store-derived work items; the command catalog and its
handlers are composed and injected by `shell`. It finds and jumps — it never mutates a setting in
place (every setting row opens its Settings section), and every verb runs through the command it was
listed as.

## Boundary

- **Public surface:** `SearchPalette`, `SearchPaletteProps`, `SearchSettings`, `initSearchPreferences`,
  `createDoubleShiftDetector`, `buildWorkItems`, `waitingItems`, `WorkItemsState`, `commandItems`,
  `SearchScope`, `PaletteItem`, `PaletteItemKind`, `PalettePreview`.
- **Allowed deps:** `contracts` (the shared matcher and domain types), `commands`, `store`, `transport`
  (the backend endpoint for browser preference keys), `clientPreferences`, `constants`, `components`,
  `lib`, `@thinkrail/ui/*`, `@remixicon/react`.
- **Forbidden:** importing `panels`, `chat` or `shell` (shell injects the commands and their handlers);
  owning a chord another module binds; sending host mutations itself outside the injected handlers and
  the store's navigation actions.

## Query grammar

A leading prefix selects a scope and its chip, and a chip writes the prefix back: `@` work (projects,
workspaces, chats), `>` commands and settings; `/` files and `#` specs join with host search. `#<digits>`
is a pull-request number, never the specs scope — it matches the `#N` keyword of the workspace that
carries that review. Quoted text is one contiguous literal term and escapes a prefix. Terms AND-combine
through the shared matcher in [[module-contracts]]. There is no filter grammar: triage happens through
the empty state's grouping and the status dots every row carries.

## Ranking

The matcher's tier decides first (exact > prefix > word start > substring > subsequence); within a tier
the match score, a decay-free frecency (Firefox's stored form, 14-day half-life), the learned
query→selection count (Firefox adaptive history: `0.9·n + 1`, prefix-matched, ×0.975 per day), the
current workspace/project boost, and the attention boost reorder. A top hit shows only when the best row
is prefix-or-better and clearly ahead, or the typed query has latched to it. Groups are ordered by their
best row and capped at four in All (thirty in a scope) with an "N more" row that switches the scope.
The empty query lists **Waiting for you** (the former session switcher's attention set, every open
project), **Recent** (by frecency), and **Actions**.

## Interaction

DOM focus stays in the input (WAI-ARIA combobox + listbox with `aria-activedescendant` and a polite
result count; chips and footer buttons are not tabbable, and Tab is always consumed). ↑/↓ select, ↵
opens or runs the row and closes the palette, Tab/Shift+Tab and `Alt+1…n` change scope (a chip writes
its prefix into the query, so the prefix is the one source of scope), `Mod+I` toggles the preview pane,
`Mod+K` closes the palette (the chord that opened it). Escape clears the query, then closes; an
untrusted (synthetic) Escape — the desktop close-item command — closes outright. `Ctrl+R` is swallowed
while the palette is open. Mutating rows are disabled while offline or before the current welcome.
The palette has one level: no pages, no per-row action panel — a row is a destination or a command.

## Preferences

The learning snapshot (≤ 500 items, ≤ 500 queries, < 200 KB), the preview choice and the double-Shift
choice are client-local: the stable native preference adapter when present, otherwise browser storage
qualified by the backend endpoint. Only ids and query prefixes are stored, never row text.

## Double Shift

`createDoubleShiftDetector` is IntelliJ's gesture: press → release → press → release of a bare Shift,
each step within 300 ms, ignored when another key went down less than 100 ms before the first press,
reset by any other key, key repeat, IME composition (`isComposing`/229), another held modifier, pointer
down, blur or a hidden document, and firing on the second release. The sandboxed HTML preview iframe never
delivers keys to the parent window, so the gesture does not fire from inside it.
