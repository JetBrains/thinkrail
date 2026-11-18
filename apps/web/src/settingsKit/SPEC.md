---
id: submodule-web-settingskit
type: submodule-design
status: active
title: settingsKit — Settings building blocks and the keyboard walk
parent: module-web
depends-on: [module-ui, module-locales, submodule-web-keybindings]
references: [submodule-web-panels, submodule-web-shell]
tags: [ui, keyboard, settings, public-surface-checked]
---

## Responsibility

The one home of every Settings building block — page, group, row with Changed/Reset, notice, choice,
slider, number field, disclosure, list row, draft — and of the keyboard engine that walks a section with
the arrows. Every Settings contributor imports it: `panels` (the dialog and its sections), `shell` (Layout
and Keyboard) and `updates`. It knows nothing about which settings exist or how they are stored: rows take
their label and id from `panels/settingsCatalog`, and resets from `panels/settingDefaults`.

## Boundary

- **Public surface (barrel):** `SettingsPage`, `SettingsGroup`, `SettingsGroupAction`, `SettingsScope`,
  `SettingsSubheading`, `SettingsRow`, `SettingsReset`, `SettingsNotice`, `SettingsNoticeVariant`,
  `SettingsChoice`, `SettingsChoiceOption`, `SettingsChoiceLayout`, `SettingsChoiceCost`,
  `SettingsSlider`, `SettingsRangeTrack`, `SettingsNumberField`, `SettingsDisclosure`, `SettingsList`,
  `useSettingsListRow`, `SETTINGS_LIST_ROW`, `SETTINGS_LIST_PRIMARY`, `useSettingsDraft`,
  `SettingsDraft`, `SETTINGS_INPUT`, `SETTINGS_TAG`, `SETTINGS_ROWS`, `SettingsDialogContainer`,
  `useSettingsDialogContainer`, `SETTING_ATTR`, `SETTINGS_KEY_SCOPE`, `holdSettingsEscape`,
  `useSettingsKeyboard`, `focusSettingRow`, `rowIdOf`, `jumpToSetting`, `revealSetting`,
  `SETTING_FLASH_MS`, `SettingsJump`, `SettingsJumpContext`, `useSettingsJump`, `useSettingsJumpTarget`,
  `walkKey`, `walkAction`, `WalkAction`, `navAction`, `NavAction`, `navIndex`, `escapeStep`,
  `EscapeStep`.
- **Allowed deps:** `@thinkrail/ui/*` (`Button`, `local-keys`, `keyboard`, `focus`, `context-menu`),
  `@thinkrail/locales/react`, `keybindings` (`LOCAL_KEY_DEFAULTS`), `lib`, `contracts` types, React and
  Remix Icon.
- **Forbidden:** `store`, `transport`, `panels`, `shell`, `chat`. Store-bound helpers (`saveSettings`,
  `settingDefaults`, `settingsCatalog`, `SettingsFolder`) stay in `panels`. Rejected: keeping the blocks in
  `panels` (it would add `search → panels` and `updates → panels` edges) and `packages/ui` (they need the
  app's local-key scopes).

## Markup is the contract

The walk reads the DOM, as focus recovery does; a React row registry was rejected (fragile order with
gated and async sections, renders on the long Keyboard page). Names live once in `settingsMarkup.ts`:

- `data-setting-row="<rowId>"` marks a walk row. Rows do not nest; the walk only sees top-level rows.
  `data-setting-id="<catalog id>"` is the jump, flash and reset-testid target; a list container or a tree
  item may carry one too.
- The row's **stop** — where the walk lands — is its `data-setting-stop`, else the tab stop in its
  `data-setting-control` slot (a roving `tabindex=0` beats `-1`), else any control that is not a side, else
  the row itself. A row containing a `role="tree"` is entered at its first visible item going down and its
  last going up, and from the nav at the tree's own cursor (its `tabindex=0` item, else the first). A row
  without a focusable stop (hidden or disabled) is skipped.
- `data-setting-side` marks a row action reached with →, `data-setting-reset` the Reset side. A tree item
  is its own unit for sides, so sides inside trees must stay tabbable and must not use
  `treeRowControlProps` (hint mode skips `aria-hidden` pointer duplicates).
- `data-setting-clean` marks a number field whose draft equals the saved value; `data-pending` an
  expensive choice's pending option; `data-setting-flash` a jump's transient flash.
- Lists reuse focus recovery's `data-focus-list`, `data-focus-row` and `data-focus-row-primary`
  ([[module-web]], *Get right*); a list's empty-state control carries `data-focus-fallback`.
- The frame marks itself with `data-settings-dialog` (the dialog), `data-settings-content` (the content
  pane) and `data-settings-search` (the search field and its results); the shell finds the Settings layer
  and the cheatsheet surface through the first.
- Key scopes: `settings.nav` on the tablist, `settings` on the content pane, `settings.list` on each list
  ([[submodule-web-keybindings]]).
- **Every tab stop renders an explicit `tabIndex`** (`0`, or `-1` on a non-active roving item): macOS
  WKWebView's Tab skips a button without one ([[module-web]], *Get right*). `tabStops.test.tsx` pins it.

## The walk

`useSettingsKeyboard({ toNav, toResults?, onRowFocus? })` returns one `onKeyDown`/`onFocus` pair for the
content pane. It runs in the bubble phase, after the focused control, ignores a `defaultPrevented` press,
an open IME composition and a press from a portaled layer that bubbles through React (a popover or nested
dialog outside the pane's DOM), and matches through `useLocalKeys("settings", …)` so the twins and Delete
follow rebinding. The pure decisions are `settingsKeys.ts` (`walkKey` → `walkAction`, `navAction` /
`navIndex`, `escapeStep`); `settingsWalk.ts` applies them over a minimal element interface, and
`settingsKeyDown` is the hook's whole handler over the same interface, so all three are unit-tested on a
fake DOM (`settingsFakeDom.test.ts`).

- **↑/↓/j/k** go to the previous/next row's stop, from single-line text fields too (not from a textarea or
  contenteditable). The edges do not wrap and still consume the key, so a range input or a caret never
  steps on it. From a side or a control inside a tree item (a Reset, a model's choice) they step to the
  previous/next visible item of the same tree, and only past its first or last item to the neighbouring
  row; on the item itself the tree moves and leaves only its edges. **Home/End** go to the first/last row
  outside text entry, and from a side or a control inside a tree item to that tree's first/last visible
  item.
- **→/l** go to the row's first side, then the next; **←/h** go back along the sides to the stop, and
  elsewhere call `toNav`. In a text field ←/→ move the caret.
- **Delete** (`settings.reset`) clicks the row's (or tree item's) Reset, moving focus to the stop first
  when it was on a side. Not while typing: in a text field only a clean number field resets.
- **Esc** reaching the pane calls `toResults` when given (the dialog passes it only while a search jump
  can be returned to: query kept, same section), else `toNav`. `escapeStep` is the dialog's whole ladder:
  content → results after a jump, else nav; results → clear; search → clear, then nav; nav → close.
- **Esc and Radix.** Radix's dialog decides in document capture, before any element sees the press, and
  calls `preventDefault` either way. `holdSettingsEscape` is the dialog's `onEscapeKeyDown`: with focus in
  the content or the search it makes the press read as prevented to that one check only (the flag
  reverts in the microtask checkpoint after Radix's listener), so the dialog stays open and the element
  then sees a clean press. An element step (draft revert, pending choice, filter clear, recorder cancel)
  calls `preventDefault` and the walk leaves it alone; otherwise the walk takes its ladder step. Focus in
  the nav, on Close or on the dialog lets Radix close. A synthetic Esc dispatched from script stays held
  for its whole dispatch, so nothing steps; `close-item` closes Settings directly instead.
- **Composites own their arrows and leave the edges.** A choice, slider, tree or picker handles its own
  keys and prevents only what it consumed; at an edge it leaves the press alone and the walk continues.
  `panels/treeNavigation`'s `Tree leaveAtEdges` does this for trees.
- `onFocus` reports the focused row's id for the dialog's last-focused memory (keyed by the resolved
  section, so a retired id shares its successor's memory); `focusSettingRow(root, id)` enters a section at
  that row, else the first, and a tree row at the tree's cursor.

## Blocks

- **`SettingsPage`** titles a section; its header keeps the documented close-button reserve
  (`pr-[2rem]`), because the dialog's Close floats over the content's top-right corner.
- **`SettingsRow`** takes `settingId` (or a `rowId`), `label`, `description`, `control`, `sides`,
  `reset={{ changed, onReset }}` and `layout`: `inline` (default), `stacked` (the control under the label,
  Reset beside it) or `card` (stacked inside a bordered card). While changed it shows a visible "Changed" tag after the label and a
  "Reset" side button (`settings-reset-<id>`, aria "Reset <label> to default"); unchanged, neither.
  Activating Reset moves focus to the row's stop before `onReset`, so focus survives the button
  unmounting.
- **`SettingsChoice`** is a single-select `role=listbox` of `role=option` buttons (`aria-selected` on the
  applied value), `layout` segmented (←/→, `aria-orientation=horizontal`) or list/cards (↑/↓), roving
  `tabIndex` on pending ?? value. Native radios were rejected (they cannot hold focus on an unchecked
  option, WebKit Tab skips them, and arrows check natively before a pending state exists); `role=radio`
  buttons were the plan, but the lint gate's `useSemanticElements` rejects them, and a listbox whose
  selection does not follow focus is the same model. Hint mode labels `option`. `cost="cheap"` applies
  on each arrow; `cost="expensive"` moves a pending option with the visible "Press Enter to apply",
  applies on Enter/Space (the focused pending option's own click), cancels on Esc or leaving the group.
  `onPendingChange` reports the pending option (or `null`) so a row can describe it. A click — so a
  hint-mode press — applies at once. `useSettingsChoice` holds this state and key handler apart from the
  markup, so tests drive it headless.
- **`SettingsSlider`** is a native range over `SettingsRangeTrack`; it steps on ←/→ itself so the walk
  sees only the edges, and commits on key-up, pointer-up and blur.
- **`SettingsNumberField`** is `type=text inputMode=numeric` over `useSettingsDraft`, so ↑/↓ walk instead of
  stepping; an out-of-range draft shows "Use min–max" and is never sent. For an inheriting value it takes
  `value={null}`, a `placeholder` (the inherited value) and `onClear`: an empty draft is then valid and
  commits through `onClear`; without `onClear` an empty draft is out of range.
- **`useSettingsDraft`** is the one auto-save pattern (no Save/Apply button): Enter or blur saves a valid,
  changed value once. An invalid draft stays visible with `aria-invalid` (the number field links its range
  message through `aria-describedby`) and is never sent. A host echo never overwrites an edit in progress
  or rolls back to a value a newer in-flight save replaces, and a rejected save returns the field to the
  authoritative value. Esc reverts and prevents only when the draft differs from the value the host holds
  (or a newer in-flight save); a clean field lets Esc through to the walk, so a second Esc steps on.
- **`SettingsList` / `useSettingsListRow(id)`** take the row ids; the focused row (else the first) is the
  only tab stop, its primary and sides. Enter runs the primary, Space on the primary toggles the row's
  switch, Delete (`settings.list.remove`) calls `onRemove` (the caller confirms through `ConfirmDialog`),
  Shift+F10 / the menu key calls `onMenu`.
- **`SettingsDisclosure`** is a walk row whose toggle is its stop; it opens itself when a jump targets one
  of its `settingIds`.
- **`SettingsGroup`** shows an optional visible scope tag: This workspace, This project, All projects or
  This computer, and an optional header `action={{ rowId, control }}` (a group's New), which is its own
  walk row before the group's rows. A long title wraps.

## Jump and flash

`jumpToSetting(root, id, signal?)` waits up to 60 frames for `[data-setting-id=id]` (a section behind a skeleton),
then `revealSetting` focuses its stop (a list's first row, a tree item itself), scrolls that focused
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
the user collapsed meanwhile; `useSettingsJumpTarget()` is the id alone. The flash is a `primary-subtle` background keyframe in
`index.css` (no ring, so `focusUsage.test.ts` holds), held static under `prefers-reduced-motion`.
