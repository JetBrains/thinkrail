# New Session Modal — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-03-02 | Updated: 2026-03-05

## Overview

The New Session Modal is the entry point for starting Claude agent sessions. Users select a skill, optionally pick specs as context, and configure the session. On submit, it calls `agent/run` via `sessionStore.startSession()` and switches focus to the new session tab.

**Triggers:**
- `+ New Session` button in the header bar
- `Cmd+T` keyboard shortcut (globally registered)
- Command palette "New session" action
- `openModal(prefill?)` called from context menus — **[Planned]**

## 1. Component Hierarchy

```
<NewSessionModal>                         // renders null when closed
  <div.modal-backdrop>                    // fixed overlay, click closes modal
    <div.modal-container>                 // centered card, click.stopPropagation
      <div.modal-header>
        <h2.modal-title>                  // "New Session"
        <button.modal-close>             // × (U+00D7)
      <div.modal-body>
        <label.modal-label>              // "Session Name"
        <input.modal-input>              // name text input, autoFocus
        <label.modal-label>              // "Skill"
        <SkillGrid />                    // skill selection grid
        <label.modal-label>              // "Spec Context"
        <SpecSelector />                 // spec multiselect
        <button.modal-advanced-toggle>   // ▶/▼ Advanced
        <div.modal-advanced>             // conditionally rendered
          <label.modal-label>            // "Model"
          <select.modal-select>          // model dropdown
          <label.modal-label>            // "Max Turns"
          <div.modal-pills>              // turn preset pill buttons
          <label.modal-label>            // "Permission Mode"
          <div.modal-radio-group>        // radio buttons
      <div.modal-footer>
        <button.modal-cancel>           // "Cancel"
        <button.modal-submit>           // "Start Session" / "Starting..."
```

**Files:**
- `frontend/src/components/NewSessionModal/NewSessionModal.tsx`
- `frontend/src/components/NewSessionModal/NewSessionModal.css`
- `frontend/src/components/NewSessionModal/SkillGrid.tsx`
- `frontend/src/components/NewSessionModal/SpecSelector.tsx`
- `frontend/src/constants/skills.ts`

## 2. Modal Chrome

### 2.1 Overlay

- Class: `.modal-backdrop`
- `position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000`
- Click on backdrop calls `closeModal()` — no dirty-check confirmation

### 2.2 Container

- Class: `.modal-container`
- Width: `520px`; max-height: `80vh`; overflow-y on `.modal-body` only
- Background: `var(--panel)`, border: `1px solid var(--border)`, border-radius: `var(--radius-lg)`
- Box-shadow: `0 8px 32px rgba(0,0,0,0.4)`
- No open/close animation **[Planned]**

### 2.3 Header

- `.modal-header`: padding `var(--space-lg)`, `border-bottom: 1px solid var(--border)`
- Title (`h2.modal-title`): "New Session", `font-size: 14px; font-weight: 600`
- Close button (`.modal-close`): renders `×`, `color: var(--hint)`, hover → `var(--text)`

### 2.4 Footer

- `.modal-footer`: `display: flex; justify-content: flex-end; gap: var(--space-sm)`
- Cancel button (`.modal-cancel`): transparent bg, `var(--muted)` text
- Submit button (`.modal-submit`): `var(--blue)` bg, shows "Starting..." when submitting

## 3. Session Name Field

- Label: `SESSION NAME` via `.modal-label` (10px uppercase, `var(--hint)`)
- Input class: `.modal-input`
- Placeholder: `"e.g. Module: session-manager"`
- `maxLength={60}`, `autoFocus`
- Focus state: `border-color: var(--blue)`
- Default on submit: `name || (skillId ?? "session")`
- Auto-suggest ghost text: **[Not implemented]**

## 4. Skill Grid (`SkillGrid`)

### 4.1 Props

```typescript
interface SkillGridProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}
```

### 4.2 Layout

Skills are grouped into named sections: `"Foundation"`, `"Creation"`, `"Review"`, `"Visualization"`.

```
<div.skill-grid>
  <div.skill-group>
    <div.skill-group-label>  Foundation
    <div.skill-group-cards>
      <button.skill-card> ...
```

Cards render only `icon` + `name` (description is **not displayed** in the card).

### 4.3 Skill Catalog

**Foundation:**
- `goal-and-requirements` 🎯 Goal & Requirements
- `architecture-design` 🏛 Architecture

**Creation:**
- `module-design` 📦 Module Design
- `submodule-design` 📦 Submodule Design
- `task-spec` 📋 Task Spec
- `spec-from-code` 🔄 Spec from Code

**Review:**
- `spec-review` 🔍 Review
- `spec-lint` 📝 Lint
- `spec-status` 📊 Status
- `spec-next` 🧭 Next
- `spec-init` 🔧 Init

**Visualization:**
- `cli-progress` 📉 Progress

### 4.4 Selection Behavior

- Single select — click selected card deselects, click unselected card selects
- Optional — user can start a session with no skill selected

### 4.5 Card Styling

- `.skill-card`: `1px solid var(--border)`, `border-radius: var(--radius-sm)`, `font-size: 11px`
- `.skill-card:hover`: `border-color: var(--blue); color: var(--text)`
- `.skill-card-selected`: `border-color: var(--blue); background: rgba(122,162,247,0.07)`

## 5. Spec Selector (`SpecSelector`)

### 5.1 Props

```typescript
interface SpecSelectorProps {
  selectedIds: string[];
  onToggle: (id: string) => void;
}
```

### 5.2 Data Source

Reads from `useSpecStore((s) => s.specs)` — already fetched into store (not fetched on modal open).

### 5.3 Layout

- **Chips** (`.spec-chip`): selected specs with `×` remove button
- **Add button** (`.spec-selector-add`): `"+ Add spec"`, dashed border, toggles dropdown
- **Dropdown** (`.spec-selector-dropdown`): absolute positioned, search input + scrollable list
  - Search: filters by `title` and `id` (case-insensitive substring)
  - Items: `title` (left) + `type` (right, 10px hint)
  - Selected items: `.spec-selector-item-selected`
  - Click toggles selection (dropdown stays open for multi-select)
  - Empty state: "No specs found"
  - Not grouped by spec type (flat list)

## 6. Advanced Config

Collapsed by default. Toggle: `.modal-advanced-toggle` (▶/▼ Advanced).

### Model

- `<select.modal-select>` with options: `"claude-opus-4-6"` (default), `"claude-sonnet-4-6"`, `"claude-haiku-4-5"`

### Max Turns

- Pill buttons (`.modal-pills`): `5, 10, 20, 50, 100` — default `20`
- `.modal-pill-active`: blue border + bg tint
- No free-form number input

### Permission Mode

- Radio group (`.modal-radio-group`): `"default"`, `"acceptEdits"`, `"bypassPermissions"`, `"plan"`
- Default: `"default"`

### Stream Text

`streamText: true` always passed, not exposed in UI.

## 7. Form State Management

All state is local React `useState`:

```typescript
const [name, setName] = useState("");
const [skillId, setSkillId] = useState<string | null>(null);
const [specIds, setSpecIds] = useState<string[]>([]);
const [model, setModel] = useState("claude-opus-4-6");
const [maxTurns, setMaxTurns] = useState(20);
const [permissionMode, setPermissionMode] = useState("default");
const [showAdvanced, setShowAdvanced] = useState(false);
const [submitting, setSubmitting] = useState(false);
```

No inline error state — submit errors only reset `submitting`.

**Reset on close:** All fields reset via `useEffect` watching `[open, prefill]`.

**Prefill on open:** From `uiStore.modalPrefill`:
```typescript
interface ModalPrefill {
  skillId?: string;
  specIds?: string[];
  name?: string;
}
```

## 8. Session Creation Flow

### Submit Handler

```typescript
await startSession({
  specIds,
  config: { model, maxTurns, permissionMode, streamText: true },
  name: name || (skillId ?? "session"),
  skillId: skillId ?? undefined,
});
closeModal();
```

### RPC Call

`agent/run` with params: `{ specIds, config: { model, maxTurns, permissionMode, streamText }, name, skillId? }`

### Submit Button States

- Normal: `"Start Session"`
- Submitting: `"Starting..."`, `disabled`, `opacity: 0.5`
- No spinner element — text change only

## 9. Store Interactions

| Store | Fields Used | Purpose |
|---|---|---|
| `uiStore` | `modalOpen`, `modalPrefill`, `closeModal()` | Open/close state and prefill data |
| `sessionStore` | `startSession()` | Creates session, sets `activeSessionId` |
| `specStore` | `specs` (via `SpecSelector`) | Spec list for selection |

## 10. Keyboard Behavior

| Key | Action |
|---|---|
| `Cmd+T` / `Ctrl+T` | Open modal (global) |
| `Escape` | Close modal (global) |
| `autoFocus` on name input | Immediate focus on open |
| `Enter` → submit | **[Not implemented]** |
| Arrow key skill navigation | **[Not implemented]** |

## 11. Validation

| Field | Rule | Behavior |
|---|---|---|
| Session name | Max 60 chars | `maxLength` attribute; no inline error |
| Skill | Optional | Defaults name to `"session"` if both name and skillId empty |
| Specs | Optional | No validation |
| Model / Max turns / Permission | Enforced by UI controls | Always valid |

Submit button is **not disabled** when no skill is selected — only disabled when `submitting`.

## 12. CSS Class Reference

**Modal chrome:**

| Class | Element |
|---|---|
| `.modal-backdrop` | Fixed overlay |
| `.modal-container` | Card (520px, max-height 80vh) |
| `.modal-header` | Header row |
| `.modal-title` | h2 title (14px, 600) |
| `.modal-close` | × close button |
| `.modal-body` | Scrollable body |
| `.modal-label` | Field labels (10px uppercase, hint) |
| `.modal-input` | Name text input |
| `.modal-footer` | Footer row |
| `.modal-cancel` | Cancel button |
| `.modal-submit` | Submit button (blue bg) |

**Skill grid:**

| Class | Element |
|---|---|
| `.skill-grid` | Grid container (flex-column) |
| `.skill-group` | Group wrapper |
| `.skill-group-label` | Group heading (10px uppercase) |
| `.skill-group-cards` | Card row (flex-wrap) |
| `.skill-card` | Skill button (1px border) |
| `.skill-card-selected` | Selected state (blue) |
| `.skill-card-icon` | Icon span (14px) |
| `.skill-card-name` | Name span |

**Spec selector:**

| Class | Element |
|---|---|
| `.spec-selector` | Wrapper (position: relative) |
| `.spec-selector-chips` | Chip row |
| `.spec-chip` | Selected spec chip |
| `.spec-chip-remove` | Remove × button |
| `.spec-selector-add` | Add button (dashed border) |
| `.spec-selector-dropdown` | Dropdown panel |
| `.spec-selector-search` | Search input |
| `.spec-selector-list` | Scrollable list (max-height 200px) |
| `.spec-selector-item` | Spec option button |
| `.spec-selector-item-selected` | Selected item |
| `.spec-selector-empty` | Empty state |

**Advanced config:**

| Class | Element |
|---|---|
| `.modal-advanced-toggle` | Toggle button |
| `.modal-advanced` | Advanced panel |
| `.modal-select` | Model dropdown |
| `.modal-pills` | Pill container |
| `.modal-pill` / `.modal-pill-active` | Turn preset pills |
| `.modal-radio-group` | Radio container |
| `.modal-radio` | Radio label |

## 13. Known Limitations

- **No auto-suggest name** — static placeholder only
- **No entry animation** — renders/unmounts instantly
- **No inline error message** — submit errors silently reset button
- **No focus trap** — Tab can leave the modal
- **No ARIA attributes** — no `role="dialog"`, `aria-modal`, or focus management
- **No Enter-to-submit** — only button click works
- **No dirty-check on backdrop click** — closes immediately
- **Skill cards show icon + name only** — no description line
- **Spec dropdown not grouped** — flat list
- **No loading spinner** — text change only on submit

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §3
- **Depends on:** [Agent Module](../../backend/app/agent/README.md) (`AgentConfig`, `agent/run`), [API Client](../src/api/README.md)
- **Related:** [State Management](../src/store/README.md) (`sessionStore.startSession`, `uiStore`)
- **Skills data:** `frontend/src/constants/skills.ts`
