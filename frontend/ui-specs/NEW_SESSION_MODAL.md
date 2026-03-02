# New Session Modal — Sub-Specification

> Parent: [WEBVIEW.md](../WEBVIEW.md) §3 | Status: **Active** | Created: 2026-03-02

## Overview

The New Session Modal is the entry point for starting Claude agent sessions. Users select a skill, optionally pick specs as context, and configure the session. On submit, it calls `agent/run` and creates a new tab in the center panel.

**Triggers:**
- `+ New Session` button in header bar
- `Cmd+T` keyboard shortcut
- Context menu "New session for this spec" (pre-fills spec)
- Context menu "Implement" / "Edit spec" (pre-fills spec + skill)

## 1. Component Hierarchy

```
<ModalOverlay>                         // fixed backdrop, click-outside to close
  <ModalContainer>                     // centered card
    <ModalHeader>                      // title + close button
    <SessionNameField />               // text input with auto-suggest
    <SkillGrid>                        // skill selection cards
      <SkillCard /> ...
    </SkillGrid>
    <SpecSelector />                   // multiselect spec picker
    <AdvancedConfig />                 // collapsible config section
    <ModalFooter>                      // Cancel + Start buttons
      <CancelButton />
      <StartButton />
    </ModalFooter>
  </ModalContainer>
</ModalOverlay>
```

## 2. Modal Chrome

### 2.1 Overlay

- Fixed position, `inset: 0`
- Background: `rgba(0,0,0,.55)` (semi-transparent dark)
- Click outside modal → close (with confirmation if form is dirty)
- `z-index: 1000`

### 2.2 Container

```
┌──────────────────────────────────────────────────┐
│  ✨ New Session                              ✕   │
│──────────────────────────────────────────────────│
│                                                  │
│  SESSION NAME                                    │
│  ┌────────────────────────────────────────────┐  │
│  │ e.g. Module: session-manager               │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  SKILL                                           │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│  │🎯 Goal │ │🏛 Arch │ │📦 Mod  │ │📋 Task │   │
│  └────────┘ └────────┘ └────────┘ └────────┘   │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│  │🔍 Rev  │ │📊 Stat │ │🔧 Init │ │📝 Lint │   │
│  └────────┘ └────────┘ └────────┘ └────────┘   │
│                                                  │
│  SPECS (optional)                                │
│  ┌─ Spec Module ✕ ── Core Module ✕ ── + ──────┐ │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ▸ Advanced                                      │
│                                                  │
│                    [Cancel]  [Start Session →]   │
└──────────────────────────────────────────────────┘
```

- Width: 520px (max 96vw)
- Background: `--panel`
- Border: `1px solid --blue`
- Border-radius: 12px
- Box-shadow: `0 10px 50px rgba(0,0,0,.65)`
- Entry animation: fade in overlay + slide up modal (200ms)

## 3. Session Name Field

### 3.1 Input

- Label: "SESSION NAME" (uppercase, 10px, `--hint`)
- Placeholder: "e.g. Module: session-manager"
- Full-width text input matching existing `.minput` style
- Auto-focus on modal open

### 3.2 Auto-Suggest

When a skill and/or spec are selected, the placeholder updates to suggest a name:

| Selection | Suggested Name |
| --- | --- |
| Skill: module-design | "module-design" |
| Skill: module-design + Spec: Spec Module | "module-design: Spec Module" |
| Spec only: Spec Module | "Spec Module" |

The suggestion appears as a ghost text in the input if the user hasn't typed anything. User typing overrides it.

### 3.3 Validation

- **Optional** — if empty, auto-generated from skill + spec selection
- Max length: 60 characters
- Trimmed on submit

## 4. Skill Grid

### 4.1 Layout

2-column or 4-column grid depending on modal width. Each skill is a card.

### 4.2 Skill Cards

```
┌────────────────────────┐
│ 🎯                     │
│ Goal & Requirements    │
│ Define project goal    │
└────────────────────────┘
```

- Background: `--elevated`
- Border: 2px solid `--border` (unselected) / `--blue` (selected)
- Border-radius: 8px
- Padding: 9px 11px
- Icon: 17px emoji
- Name: 11px, bold, `--text`
- Description: 10px, `--hint`, 1-2 lines, line-height 1.35

### 4.3 Skill Catalog

Grouped by purpose:

**Foundation**

| Skill ID | Icon | Name | Description |
| --- | --- | --- | --- |
| `goal-and-requirements` | 🎯 | Goal & Requirements | Define project goal and requirements |
| `architecture-design` | 🏛 | Architecture | Create system architecture document |

**Creation**

| Skill ID | Icon | Name | Description |
| --- | --- | --- | --- |
| `module-design` | 📦 | Module Design | Design a module-level specification |
| `submodule-design` | 📦 | Submodule Design | Design a sub-component specification |
| `task-spec` | 📋 | Task Spec | Create an actionable task specification |
| `spec-from-code` | 🔄 | Spec from Code | Reverse-engineer specs from existing code |

**Review & Tooling**

| Skill ID | Icon | Name | Description |
| --- | --- | --- | --- |
| `spec-review` | 🔍 | Review | Review specs against code for accuracy |
| `spec-lint` | 📝 | Lint | Validate spec structure and consistency |
| `spec-status` | 📊 | Status | Show coverage, health, and gaps |
| `spec-next` | 🧭 | Next | Suggest what to specify next |
| `spec-init` | 🔧 | Init | Initialize spec-driven project structure |

**Visualization**

| Skill ID | Icon | Name | Description |
| --- | --- | --- | --- |
| `visualisation` | 📈 | Visualize | Terminal visualization toolkit |
| `cli-progress` | 📉 | Progress | Show progress with terminal graphics |

### 4.4 Selection Behavior

- **Single select** — one skill at a time
- Click to select, click again to deselect
- Selected card: blue border, subtle blue background tint (`rgba(122,162,247,.07)`)
- **Optional** — sessions can start without a skill (free-form chat)

### 4.5 Pre-fill from Context Menu

When triggered from a graph node context menu:
- "Implement" → pre-selects `task-spec` skill
- "Edit spec" → pre-selects the matching design skill (module-design for modules, etc.)
- "New session for this spec" → no skill pre-selected, spec pre-filled

## 5. Spec Selector

### 5.1 Layout

A chip-based multiselect input that fetches specs via `spec/list`.

```
┌─ Spec Module ✕ ── Core Module ✕ ── + ──────────┐
└─────────────────────────────────────────────────┘
```

### 5.2 Behavior

- Click `+` or the empty area → opens a dropdown of all specs
- Dropdown items: icon + title + type badge (grouped by spec type)
- Search/filter input at top of dropdown
- Click a spec → adds it as a chip
- Click `✕` on a chip → removes it
- Multiple specs can be selected

### 5.3 Chip Display

Each selected spec appears as a removable chip:
- Background: `--elevated`
- Border: `1px solid --border`
- Text: 10px, `--muted`
- Icon: spec type emoji
- Close button: `✕`, `--hint`, hover → `--text`

### 5.4 Dropdown

- Max height: 200px, scrollable
- Items grouped by type: Goal, Architecture, Module, Submodule, Task
- Each item: `icon + title + type badge`
- Hover: `--elevated` background
- Already-selected items: dimmed or checkmarked
- Filter input at top for fuzzy search by title

### 5.5 Pre-fill

When triggered from context menu or graph node, the relevant spec is pre-filled as a chip.

### 5.6 Data Source

On modal open, call `spec/list` RPC to fetch current specs. Cache the result; invalidate on `registry/didUpdate` notification.

## 6. Advanced Config

Collapsible section, collapsed by default. Toggle via `▸ Advanced` / `▾ Advanced`.

### 6.1 Fields

| Field | Type | Default | Options |
| --- | --- | --- | --- |
| **Model** | Dropdown | `claude-opus-4-6` | `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-haiku-4-5` |
| **Max turns** | Number input | `20` | 5, 10, 20, 50, 100 (preset buttons or free input) |
| **Permission mode** | Radio group | `ask` | `allow` (auto-approve all), `ask` (prompt per tool), `deny` (block tools) |

### 6.2 Layout

```
▾ Advanced
  ┌────────────────────────────────────────────────┐
  │  Model          [claude-opus-4-6        ▾]     │
  │  Max turns      [5] [10] [●20] [50] [100]     │
  │  Permissions    ○ Allow all  ● Ask  ○ Deny     │
  └────────────────────────────────────────────────┘
```

- Model dropdown: styled select, `--elevated` background
- Max turns: preset pill buttons, selected one highlighted with `--blue`
- Permission mode: radio group with labels and brief descriptions on hover

### 6.3 Streaming

`stream_text` is always `true` — not exposed in the UI. The Chat UI depends on streaming for real-time text rendering.

## 7. Modal Actions

### 7.1 Start Session

- Button text: "Start Session →"
- Style: primary button (`--blue` background, `--panel` text, bold)
- Disabled when no skill is selected (unless free-form sessions are allowed)
- On click:
  1. Validate form
  2. Construct RPC params (see §9)
  3. Call `agent/run`
  4. Close modal
  5. Create new session tab in center panel
  6. Switch to the new tab

### 7.2 Cancel

- Button text: "Cancel"
- Style: secondary button (`--elevated` background, `--text` color)
- On click: close modal, discard form state

### 7.3 Loading State

After clicking "Start Session", the button shows a spinner and "Starting..." text. The modal stays open until the `agent/run` RPC response arrives (typically <1s). On error, show inline error message above the footer.

## 8. Validation

| Field | Rule | Error Message |
| --- | --- | --- |
| Session name | Max 60 chars, trimmed | "Name too long" |
| Skill | Optional (free-form allowed) | — |
| Specs | Optional | — |
| Model | Must be valid model ID | — (dropdown enforces) |
| Max turns | 1–500, integer | "Must be 1–500" |

Minimal validation — the modal is intentionally lightweight. Most fields have sensible defaults.

## 9. RPC Integration

### 9.1 Constructing the Request

```typescript
function buildRunParams(form: ModalForm): AgentRunParams {
  return {
    specIds: form.selectedSpecIds,          // string[] (may be empty)
    config: {
      model: form.model,                    // "claude-opus-4-6"
      max_turns: form.maxTurns,             // 20
      permission_mode: form.permissionMode, // "ask"
      stream_text: true,                    // always true
    }
  };
}
```

### 9.2 Skill Handling

Skills are not part of `AgentConfig`. Instead, when a skill is selected:
1. The skill's prompt/instructions are loaded from the plugin
2. Passed as the initial user message or system context alongside spec content
3. The backend `agent/run` handler loads spec content from `specIds` and prepends skill instructions

**Note:** The exact mechanism for passing skill selection to the backend may need an additional field in `agent/run` params (e.g., `skillId: string`). This should be added to the Agent Module spec if not already present.

### 9.3 Response Handling

```typescript
// On submit:
const { taskId } = await rpc.call("agent/run", params);

// Create session tab:
sessionStore.addSession({
  taskId,
  name: form.sessionName || autoName(form),
  skill: form.selectedSkill,
  specIds: form.selectedSpecIds,
  status: "running",
  startedAt: new Date(),
});

// Switch to new tab:
sessionStore.setActiveSession(taskId);

// Close modal:
modalStore.close();

// Agent events will stream in via agent/* notifications keyed by taskId
```

### 9.4 Error Handling

| Error | Behavior |
| --- | --- |
| Network error | Show inline error: "Failed to connect to backend" |
| RPC error (-32603) | Show inline error: "Internal server error" |
| Invalid params | Should not happen (frontend validates) |

Error message appears above the footer buttons in red. Modal stays open so user can retry.

## 10. Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Cmd+T` | Open modal (global) |
| `Escape` | Close modal |
| `Enter` | Start session (when focused on Start button or name field) |
| `Tab` | Move between fields (name → skills → specs → advanced → buttons) |
| `Arrow keys` | Navigate within skill grid |
| `Space` | Toggle selected skill card (when focused) |

### Focus Flow

1. Modal opens → focus on session name input
2. Tab → first skill card
3. Arrow keys → navigate skill grid
4. Tab → spec selector
5. Tab → advanced toggle
6. Tab → Cancel button
7. Tab → Start button

## 11. Animation

### 11.1 Open

```css
/* Overlay */
#modal-overlay {
  transition: opacity 0.18s ease;
}
#modal-overlay.show { opacity: 1; }

/* Container */
#modal-container {
  transition: transform 0.2s ease;
  transform: translateY(8px);
}
#modal-overlay.show #modal-container {
  transform: translateY(0);
}
```

### 11.2 Close

Reverse: fade out overlay, slide down container. Duration: 150ms.

### 11.3 Skill Card Selection

```css
.skill-card {
  transition: border-color 0.15s, background 0.15s;
}
.skill-card.selected {
  border-color: var(--blue);
  background: rgba(122,162,247,.07);
}
```

## 12. State Management

```typescript
interface ModalState {
  isOpen: boolean;

  // Form fields
  sessionName: string;
  selectedSkillId: string | null;
  selectedSpecIds: string[];
  model: string;           // default: "claude-opus-4-6"
  maxTurns: number;        // default: 20
  permissionMode: string;  // default: "ask"

  // UI
  advancedOpen: boolean;
  specDropdownOpen: boolean;
  submitting: boolean;
  error: string | null;

  // Data (fetched)
  availableSpecs: RegistryEntry[];

  // Pre-fill (set by context menu trigger)
  prefillSpecIds: string[];
  prefillSkillId: string | null;
}
```

### Actions

| Action | Trigger | Effect |
| --- | --- | --- |
| `openModal(prefill?)` | Cmd+T, + button, context menu | Set `isOpen`, apply prefill, fetch specs |
| `closeModal` | Escape, Cancel, overlay click | Reset form, set `isOpen: false` |
| `setSessionName(name)` | Text input | Update `sessionName` |
| `selectSkill(id)` | Click skill card | Set `selectedSkillId` (toggle off if same) |
| `addSpec(id)` | Click spec in dropdown | Add to `selectedSpecIds` |
| `removeSpec(id)` | Click ✕ on chip | Remove from `selectedSpecIds` |
| `toggleAdvanced` | Click "Advanced" | Toggle `advancedOpen` |
| `setModel(id)` | Dropdown change | Update `model` |
| `setMaxTurns(n)` | Pill click or input | Update `maxTurns` |
| `setPermissionMode(m)` | Radio change | Update `permissionMode` |
| `submit` | Start Session click | Set `submitting`, call RPC, handle result |

## 13. Accessibility

- Modal uses `role="dialog"` with `aria-modal="true"` and `aria-labelledby` pointing to the title
- Focus trapped inside modal while open
- Escape key closes modal
- Skill cards use `role="radio"` within a `role="radiogroup"`
- Spec chips use `role="listitem"` with clear remove button labels
- Loading state announced via `aria-live="polite"`
- Error messages linked via `aria-describedby` to the Start button

## 14. CSS Class Reference

Classes reused from mockup (bonsai-web-v2.html modal pattern):

| Class | Element |
| --- | --- |
| `#overlay` | Modal backdrop |
| `#modal` | Modal container |
| `.mlabel` | Field labels |
| `.minput` | Text inputs |
| `.skgrid` | Skill grid container |
| `.skcard` | Skill card |
| `.skcard.on` | Selected skill |
| `.mfooter` | Footer button row |
| `.mbtn` | Button base |
| `.mbtn.pri` | Primary button |

New classes:

| Class | Element |
| --- | --- |
| `.spec-selector` | Spec multiselect container |
| `.spec-chip` | Selected spec chip |
| `.spec-chip .chip-remove` | Remove button on chip |
| `.spec-dropdown` | Spec dropdown panel |
| `.spec-dropdown-item` | Dropdown item |
| `.advanced-toggle` | Collapsible trigger |
| `.advanced-body` | Collapsible content |
| `.config-pills` | Max turns pill group |
| `.config-pill` | Individual pill button |
| `.config-pill.on` | Selected pill |
| `.modal-error` | Inline error message |
| `.modal-spinner` | Loading spinner in button |

## Known Limitations

- **Skill list is hardcoded:** Skills are enumerated in the frontend, not dynamically fetched from the plugin system
- **No session templates:** Cannot save and reuse session configurations
- **No spec preview:** Selected specs are shown as chips but their content is not previewed in the modal

## Related Specs

- **Parent:** [Web View](WEBVIEW.md) §3
- **Depends on:** [Agent Module](../../backend/app/agent/README.md) (AgentConfig, agent/run), [API Client](../src/api/README.md)
- **Related:** [State Management](../src/store/README.md) (sessionStore.startSession)
