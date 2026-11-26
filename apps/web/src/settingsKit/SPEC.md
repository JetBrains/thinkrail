---
id: submodule-web-settingskit
type: submodule-design
status: active
title: settingsKit — Settings building blocks and the keyboard tree
parent: module-web
depends-on: [module-ui, module-locales, submodule-web-keybindings]
references: [submodule-web-panels, submodule-web-shell]
tags: [ui, keyboard, settings, public-surface-checked]
---

## Responsibility

The one home of every Settings building block — page, group, row with Changed/Reset, line, notice,
choice, slider, number field, disclosure, list row, draft — and of the keyboard engine that walks a
section as a tree of rows with the arrows. Every Settings contributor imports it: `panels` (the dialog and its sections), `shell` (Layout
and Keyboard) and `updates`. It knows nothing about which settings exist or how they are stored: rows take
their label and id from `panels/settingsCatalog`, and resets from `panels/settingDefaults`.

## Boundary

- **Public surface (barrel):** `SettingsPage`, `SettingsGroup`, `SettingsGroupAction`, `SettingsScope`,
  `SettingsSubheading`, `SettingsRow`, `SettingsReset`, `SettingsLine`, `SettingsNotice`,
  `SettingsNoticeVariant`, `SettingsChoice`, `SettingsChoiceOption`, `SettingsChoiceLayout`,
  `SettingsChoiceCost`, `SettingsSlider`, `SettingsRangeTrack`, `SettingsNumberField`,
  `SettingsDisclosure`, `SettingsList`, `useSettingsListRow`, `SETTINGS_LIST_ROW`, `SETTINGS_LIST_PRIMARY`,
  `useSettingsDraft`, `SettingsDraft`, `SETTINGS_INPUT`, `SETTINGS_TAG`, `SETTINGS_ROWS`,
  `SETTINGS_ROW_FOCUS`, `SETTINGS_ROW_INSET`, `SettingsRowCursorContext`, `useSettingsRowStop`,
  `SettingsDialogContainer`, `useSettingsDialogContainer`, `SETTING_ATTR`, `SETTINGS_KEY_SCOPE`,
  `holdSettingsEscape`, `useSettingsKeyboard`, `focusSettingRow`, `focusUnitStop`, `rowIdOf`,
  `jumpToSetting`, `revealSetting`, `SETTING_FLASH_MS`, `SettingsJump`, `SettingsJumpContext`,
  `useSettingsJump`, `useSettingsJumpTarget`, `walkKey`, `walkAction`, `WalkAction`, `navAction`,
  `NavAction`, `navIndex`, `escapeStep`, `EscapeStep`.
- **Allowed deps:** `@thinkrail/ui/*` (`Button`, `local-keys`, `keyboard`, `focus`, `context-menu`),
  `@thinkrail/locales/react`, `keybindings` (`LOCAL_KEY_DEFAULTS`), `lib`, `contracts` types, React and
  Remix Icon.
- **Forbidden:** `store`, `transport`, `panels`, `shell`, `chat`. Store-bound helpers (`saveSettings`,
  `settingDefaults`, `settingsCatalog`, `SettingsFolder`) stay in `panels`. Rejected: keeping the blocks in
  `panels` (it would add `search → panels` and `updates → panels` edges) and `packages/ui` (they need the
  app's local-key scopes).

## The model: a tree of rows

A section is an explicit two-level tree (user, 2026-11-20, mockup variant A): **rows**, each holding its
**parts** — controls, a switch, a primary and buttons. Focus rests on the whole row; the arrows walk rows
and never change a value; a value changes only inside a control the user entered. Groups are plain headers,
not nodes and not collapsible; a group's header action ("+ New template") is a row of its own. Rejected:
keeping focus on the controls and stopping cheap choices from applying on the way (variant B) — walking
still landed inside every control, and → kept meaning both "next option" and "next button".

**Visible.** The focused row wears `focus-ring-row` — a `primary-subtle` fill with a 2px `focus-ring` bar
on its left edge — and keeps it while focus is inside it (`SETTINGS_ROW_FOCUS`, [COLOR.md](../styles/COLOR.md),
*Focus ring*). A control being edited also wears `focus-ring-editing`, an outset frame around the whole
control (a choice's listbox, a slider's track; a text field's own ring is its frame). Rows
pad their content by 8px (`SETTINGS_ROW_INSET`) so the fill and the bar clear the text; group titles and
loose group text take the same 8px so they line up. Not chosen (round 2): group chevrons, `›` hints on
enterable rows, a key bar under the content.

## Markup is the contract

The walk reads the DOM, as focus recovery does; a React row registry was rejected (fragile order with
gated and async sections, renders on the long Keyboard page). Names live once in `settingsMarkup.ts`:

- `data-setting-row="<rowId>"` marks a row. Rows do not nest; the walk only sees top-level rows. A row that
  can take focus (`SettingsRow`, `SettingsLine`, a list row, a notice with `rowId`, a disclosure toggle) is
  its own **stop**. A row that cannot — a group's action wrapper, Providers' Refresh — is a container: its
  stop is its first focusable part (a roving `tabindex=0` beats `-1`). A row holding a `role="tree"` is
  entered at its first visible item going down and its last going up, and from the nav at the tree's own
  cursor; each tree item is a unit like a row, its own stop. A row without a stop (hidden, or a container
  whose parts are all disabled) is skipped.
- `data-setting-id="<catalog id>"` is the jump, flash and reset-testid target; a list container or a tree
  item may carry one too.
- A row's parts are every focusable inside it that belongs to no nested unit, minus `aria-hidden` pointer
  duplicates and file inputs. A part is a **control** when it edits a value: a `role="listbox"` (the
  choice), a text field or textarea, a range or a select. The row's **switch** is its first
  `role="switch"` (or a `data-setting-toggle`, Visible models' tri-state provider toggle) outside a
  control; its **primary** is `data-setting-primary` (a list row's Edit/Details/apply; the KeybindingTree
  shortcut item, which marks itself `data-focus-row-primary`). Every other part is a **button** — Reset,
  Edit, ×, Copy path, Open folder, a popup trigger such as a font or model picker, a description link —
  ordered as they show on screen: top to bottom, then left to right on a line. `data-setting-reset` marks
  the Reset among them. `data-setting-control` marks `SettingsRow`'s control slot; the walk does not read it.
- `data-setting-clean` marks a number field whose draft equals the saved value; `data-pending` an
  expensive choice's pending option; `data-setting-flash` a jump's transient flash.
- Lists reuse focus recovery's `data-focus-list` and `data-focus-row`, and the row itself is focus
  recovery's target (no `data-focus-row-primary` on a Settings list row, so removing one lands on its
  neighbour row); a list's empty-state control carries `data-focus-fallback`.
- The frame marks itself with `data-settings-dialog` (the dialog), `data-settings-content` (the content
  pane) and `data-settings-search` (the search field and its results); the shell finds the Settings layer
  and the cheatsheet surface through the first.
- Key scopes: `settings.nav` on the tablist, `settings` on the content pane, `settings.list` on each list
  ([[submodule-web-keybindings]]).
- **Every tab stop renders an explicit `tabIndex`** (`0`, or `-1` on a non-active roving item): macOS
  WKWebView's Tab skips a button without one ([[module-web]], *Get right*). Rows rove too — a
  `SettingsRow`, line, notice, list row and disclosure toggle alike (`useSettingsRowStop` /
  `useSettingsRowRoving` over a per-dialog cursor store, so a move re-renders two rows, not the section).
  The cursor is the row focused last; the dialog resets it to the section's remembered row on a section
  change and on open. While it names no rendered row (nothing remembered yet, or that row is gone or not
  loaded), the first rendered row holds `tabIndex=0`, as a list's first row does, so Tab from the nav lands
  on a row from the start. For that fallback alone each roving row registers its element with the cursor,
  ordered by document position, never by mount order. A container row (a group action, a tree's holder)
  is not registered: its parts keep their own stops. Controls and buttons keep their own stops, so Tab
  still reaches everything; Shift+Tab from a control lands on its row. `tabStops.test.tsx` and
  `settingsRowCursor.test.ts` pin it.
- **Every tab stop in the content is a row's stop or part.** A failed load's Retry, a notice's action and
  an empty state's actions sit in a `SettingsLine` or a `SettingsNotice` with `rowId`; a group description
  with a link takes `descriptionRowId`. `settingsDrift.test.tsx` holds the kit to it over static markup,
  and e2e's `settings-tree.spec.ts` walks every section with the keys ([[module-browser-e2e]]).

## The walk

`useSettingsKeyboard({ toNav, toResults?, onRowFocus? })` returns the content pane's `onKeyDown`/`onFocus`
pair and the row cursor the dialog provides through `SettingsRowCursorContext`. It runs in the bubble
phase, after the focused control, ignores a `defaultPrevented` press, an open IME composition and a press
from a portaled layer that bubbles through React (a popover or nested dialog outside the pane's DOM), and
matches through `useLocalKeys("settings", …)` so the twins and Delete follow rebinding. The pure decisions
are `settingsKeys.ts` (`walkKey` → `walkAction` over the focus's place — row, button, control or
outside — `navAction` / `navIndex`, `escapeStep`); `settingsWalk.ts` applies them over a minimal element
interface, and `settingsKeyDown` is the hook's whole handler over the same interface, so all three are
unit-tested on a fake DOM (`settingsFakeDom.test.ts`, which also parses static markup).

- **↑/↓/j/k** go to the previous/next row's stop — from a row, a button, a control that left them (a
  segmented choice, a slider) and a single-line text field, never from a textarea. The edges do not wrap
  and still consume the key. From a part inside a tree item they step to the previous/next visible item
  of that tree, and only past its first or last item to the neighbouring row; on an item itself the tree
  moves and leaves only its edges. **Home/End** go to the first/last row outside text entry, and from a
  part of a tree item to that tree's first/last item.
- **On a row:** **→/l** go to its first button, without touching the value; a row with no buttons enters
  its first control instead; a disclosure toggle opens on →, and, open, → steps into it. **←/h** go to the
  section list (a disclosure that is open closes first). **Enter or Space** enter the first control (a
  choice at its roving option, a field with its text selected). A row with no control: its primary (Edit,
  Details), else its switch, else its only button (Reset aside), else focus its first button. **Space on a
  row with a switch toggles it** and stays. A stop that is itself a button (a disclosure, a group action)
  keeps Enter and Space native; so does a tree item that handles them (an area toggles, a shortcut records).
- **On a button:** **→/l** and **←/h** walk the row's buttons; ← from the first returns to the row, →
  past the last stays. Enter and Space are the button's own.
- **Inside a control** the control's keys come first: arrows change the value (a cheap choice applies on
  each, an expensive one moves its pending pick), a field types and moves its caret. **Esc or Enter return
  to the row keeping the value**: the choice handles both itself (Enter applies the focused option, Esc
  cancels a pending pick), the draft commits on Enter and leaves for the row when the value is valid, and
  any other Enter (Space too, outside a text field) leaves through the walk; a textarea and a field inside a
  `<form>` keep Enter. An arrow the control does not use at its edge moves along the row: **← at a choice's
  first option or a slider's minimum** (and ← anywhere in a vertical list) goes to the row's previous
  control, else back to the row; **→ at the last option, the maximum, or a field's caret end** goes to the
  row's next control (Custom → the Custom tokens field), else stays. A segmented choice therefore never
  consumes ←/→ at either end: the walk's step does, staying put when there is no next control. A text
  field keeps ← for its caret: it never leaves on ←, so editing never jumps away by accident. A list's
  ↑/↓ at its edge are consumed, so ↓↓↓ through a theme list never falls out of it.
- **Delete** (`settings.reset`) clicks the row's (or tree item's) Reset, moving focus to the row first
  when it was inside it. Not while typing: in a text field only a clean number field resets.
- **Esc** from a control or a button returns to its row. On a row it calls `toResults` when given (the
  dialog passes it only while a search jump can be returned to: query kept, same section), else `toNav`.
  `escapeStep` is the dialog's whole ladder past the content: results after a jump, else nav; results →
  clear; search → clear, then nav; nav → close.
- **Esc and Radix.** Radix's dialog decides in document capture, before any element sees the press, and
  calls `preventDefault` either way. `holdSettingsEscape` is the dialog's `onEscapeKeyDown`: with focus in
  the content or the search it makes the press read as prevented to that one check only (the flag
  reverts in the microtask checkpoint after Radix's listener), so the dialog stays open and the element
  then sees a clean press. An element step (draft revert, pending choice, filter clear, recorder cancel)
  calls `preventDefault` and the walk leaves it alone; otherwise the walk takes its step. Focus in the nav,
  on Close or on the dialog lets Radix close. A synthetic Esc dispatched from script stays held for its
  whole dispatch, so nothing steps; `close-item` closes Settings directly instead.
- **Composites own their keys and leave what they do not use.** A choice, slider, tree or picker handles
  its own keys and prevents only what it consumed. `panels/treeNavigation`'s `Tree leaveAtEdges` keeps →/←
  for expanding and collapsing, so a parent item's buttons (a Keyboard area's Reset) are Delete's alone.
  Lists and trees follow the same rule as rows: arrows move, Enter edits or opens, → reaches a leaf's
  buttons, and a value never changes while walking — the per-model context choice in the provider tree
  is entered with Enter like any control.
- `onFocus` moves the row cursor and reports the focused row's id for the dialog's last-focused memory
  (keyed by the resolved section, so a retired id shares its successor's memory); `focusSettingRow(root,
  id)` enters a section at that row, else the first, and a tree row at the tree's cursor. A popover that a
  row opened (the font picker) returns focus to the row when it closes from the keyboard
  (`focusUnitStop`); a pointer that left it keeps its own focus.

## Blocks

- **`SettingsPage`** titles a section; its header keeps the documented close-button reserve
  (`pr-[2rem]`), because the dialog's Close floats over the content's top-right corner.
- **`SettingsRow`** takes `settingId` (or a `rowId`), `label`, `description`, `control`, `sides`,
  `reset={{ changed, onReset }}` and `layout`: `inline` (default), `stacked` (the control under the label,
  Reset beside it) or `card` (stacked inside a bordered card). It renders a `<fieldset>` labelled by its
  label and described by its description — the row the walk focuses (`role=group`; a `div` with a role was
  rejected by the lint gate's `useSemanticElements`). While changed it shows a visible "Changed" tag after
  the label and a "Reset" button (`settings-reset-<id>`, aria "Reset <label> to default"); unchanged,
  neither. Activating Reset moves focus to the row before `onReset`, so focus survives the button
  unmounting.
- **`SettingsLine`** is a walk row around custom content: a failed load and its Retry, an empty state's
  actions, an MCP preset, Environment's variables and Save. `framed` drops the inset for a bordered box.
- **`SettingsChoice`** is a single-select `role=listbox` of `role=option` buttons (`aria-selected` on the
  applied value), `layout` segmented (←/→, `aria-orientation=horizontal`) or list/cards (↑/↓), roving
  `tabIndex` on pending ?? value. Native radios were rejected (they cannot hold focus on an unchecked
  option, WebKit Tab skips them, and arrows check natively before a pending state exists); `role=radio`
  buttons were the plan, but the lint gate's `useSemanticElements` rejects them, and a listbox whose
  selection does not follow focus is the same model. Hint mode labels `option`. `cost="cheap"` applies
  on each arrow; `cost="expensive"` moves a pending option with the visible "Press Enter to apply" and
  cancels it on Esc or leaving the group. Enter or Space applies the focused option and returns to the row;
  Esc with a pending pick cancels it and returns. `onPendingChange` reports the pending option (or `null`)
  so a row can describe it. A click — so a hint-mode press — applies at once. `useSettingsChoice` holds
  this state and key handler apart from the markup, so tests drive it headless.
- **`SettingsSlider`** is a native range over `SettingsRangeTrack`; it steps on ←/→ itself so the walk
  sees only the edges, and commits on key-up, pointer-up and blur.
- **`SettingsNumberField`** is `type=text inputMode=numeric` over `useSettingsDraft`, so ↑/↓ walk instead of
  stepping; an out-of-range draft shows "Use min–max" and is never sent. For an inheriting value it takes
  `value={null}`, a `placeholder` (the inherited value) and `onClear`: an empty draft is then valid and
  commits through `onClear`; without `onClear` an empty draft is out of range.
- **`useSettingsDraft`** is the one auto-save pattern (no Save/Apply button): Enter or blur saves a valid,
  changed value once, and a valid Enter also returns to the row. An invalid draft stays visible with
  `aria-invalid` (the number field links its range message through `aria-describedby`), is never sent, and
  keeps focus on Enter. A host echo never overwrites an edit in progress or rolls back to a value a newer
  in-flight save replaces, and a rejected save returns the field to the authoritative value. Esc reverts
  and prevents only when the draft differs from the value the host holds (or a newer in-flight save); a
  clean field lets Esc through to the walk, which returns to the row. An optional `normalize` (the Projects
  folder's trim) runs on a valid draft before that once-only check, so the value sent, the in-flight entry and
  the host's echo are the same string; a draft that normalizes to what the host holds is only tidied.
- **`SettingsList` / `useSettingsListRow(id)`** take the row ids; each `li` is a roving walk row, and the
  focused row (else the first) is the only one whose primary and buttons are tab stops. On the row Enter
  runs the primary and Space toggles the row's switch (the walk's rules), Delete (`settings.list.remove`)
  calls `onRemove` (the caller confirms through `ConfirmDialog`), Shift+F10 / the menu key calls `onMenu`.
- **`SettingsNotice`** with `rowId` is a walk row whose actions are its buttons ("Add starter templates",
  Retry, Allow in browser).
- **`SettingsDisclosure`** is a walk row whose toggle is its stop; it opens itself when a jump targets one
  of its `settingIds`.
- **`SettingsGroup`** shows an optional visible scope tag: This workspace, This project, All projects or
  This computer, an optional header `action={{ rowId, control }}` (a group's New), which is its own walk
  row before the group's rows, and with `descriptionRowId` a description that is a row (its links are its
  buttons). A long title wraps.

## Jump and flash

`jumpToSetting(root, id, signal?)` waits up to 60 frames for `[data-setting-id=id]` (a section behind a skeleton),
then `revealSetting` focuses its stop (the row itself, a list's first row, a tree item itself), scrolls that focused
element to the center (so a tall list or tree shows its landing, not its middle) and sets
`data-setting-flash` on the target for `SETTING_FLASH_MS` (1.6 s). When nothing took focus (an empty list,
a disabled or hidden control) it reports nothing, without scrolling or flashing, so the wait goes on; the
first time the target is rendered and visible, `jumpToSetting` still scrolls it to the center and flashes
it once (`showSetting`), so the user sees where the setting is while a control is not yet focusable. It
resolves `false` when no landing took focus in time or the optional `AbortSignal` fires first (a newer
jump, a section change), and the caller focuses the section tab. Collapsed owners reveal themselves: the
caller provides `{ id, seq }` through `SettingsJumpContext` before jumping, with a fresh `seq` per jump,
and clears it when the jump ends or is abandoned. `useSettingsJump()` lets a disclosure or the Keyboard
tree open the group holding `id` whenever `seq` changes, so a repeat jump to the same id re-opens a group
the user collapsed meanwhile; `useSettingsJumpTarget()` is the id alone. The flash is a `primary-soft`
background keyframe in `index.css` (no ring, so `focusUsage.test.ts` holds), held static under
`prefers-reduced-motion`: one step above the focused row's `primary-subtle` fill, so it shows on the row
the jump focused and fades into that fill ([COLOR.md](../styles/COLOR.md), *Active region*).
