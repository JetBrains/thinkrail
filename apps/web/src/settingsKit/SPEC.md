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

- **Public surface (barrel):** `SettingsPage`, `SettingsGroup`, `SettingsScope`, `SettingsSubheading`,
  `SettingsRow`, `SettingsReset`, `SettingsNotice`, `SettingsNoticeVariant`, `SettingsChoice`,
  `SettingsChoiceOption`, `SettingsChoiceLayout`, `SettingsChoiceCost`, `SettingsSlider`,
  `SettingsRangeTrack`, `SettingsNumberField`, `SettingsDisclosure`, `SettingsList`,
  `useSettingsListRow`, `SETTINGS_LIST_ROW`, `SETTINGS_LIST_PRIMARY`, `useSettingsDraft`,
  `SettingsDraft`, `SETTINGS_INPUT`, `SETTINGS_TAG`, `SETTINGS_ROWS`, `SettingsDialogContainer`,
  `useSettingsDialogContainer`, `SETTING_ATTR`, `SETTINGS_KEY_SCOPE`, `useSettingsKeyboard`,
  `focusSettingRow`, `rowIdOf`, `jumpToSetting`, `revealSetting`, `SETTING_FLASH_MS`,
  `SettingsJumpContext`, `useSettingsJumpTarget`, `walkKey`, `walkAction`, `WalkAction`, `navAction`,
  `NavAction`, `navIndex`, `escapeStep`, `EscapeStep`.
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
  last going up. A row without a focusable stop (hidden or disabled) is skipped.
- `data-setting-side` marks a row action reached with →, `data-setting-reset` the Reset side. A tree item
  is its own unit for sides, so sides inside trees must stay tabbable and must not use
  `treeRowControlProps` (hint mode skips `aria-hidden` pointer duplicates).
- `data-setting-clean` marks a number field whose draft equals the saved value; `data-pending` an
  expensive choice's pending option; `data-setting-flash` a jump's transient flash.
- Lists reuse focus recovery's `data-focus-list`, `data-focus-row` and `data-focus-row-primary`
  ([[module-web]], *Get right*); a list's empty-state control carries `data-focus-fallback`.
- Key scopes: `settings.nav` on the tablist, `settings` on the content pane, `settings.list` on each list
  ([[submodule-web-keybindings]]).
- **Every tab stop renders an explicit `tabIndex`** (`0`, or `-1` on a non-active roving item): macOS
  WKWebView's Tab skips a button without one ([[module-web]], *Get right*). `tabStops.test.tsx` pins it.

## The walk

`useSettingsKeyboard({ toNav, toResults?, onRowFocus? })` returns one `onKeyDown`/`onFocus` pair for the
content pane. It runs in the bubble phase, after the focused control, ignores a `defaultPrevented` press
and an open IME composition, and matches through `useLocalKeys("settings", …)` so the twins and Delete
follow rebinding. The pure decisions are `settingsKeys.ts` (`walkKey` → `walkAction`, `navAction` /
`navIndex`, `escapeStep`); `settingsWalk.ts` applies them over a minimal element interface, so both are
unit-tested without a DOM.

- **↑/↓/j/k** go to the previous/next row's stop, from single-line text fields too (not from a textarea or
  contenteditable). The edges do not wrap and still consume the key, so a range input or a caret never
  steps on it. **Home/End** go to the first/last row outside text entry.
- **→/l** go to the row's first side, then the next; **←/h** go back along the sides to the stop, and
  elsewhere call `toNav`. In a text field ←/→ move the caret.
- **Delete** (`settings.reset`) clicks the row's Reset, moving focus to the stop first when it was on a
  side. Not while typing: in a text field only a clean number field resets.
- **Esc** reaching the pane calls `toResults` when given (the dialog passes it only while a search jump
  can be returned to: query kept, same section), else `toNav`. `escapeStep` is the dialog's whole ladder:
  content → results after a jump, else nav; results → clear; search → clear, then nav; nav → close.
- **Composites own their arrows and leave the edges.** A choice, slider, tree or picker handles its own
  keys and prevents only what it consumed; at an edge it leaves the press alone and the walk continues.
  `panels/treeNavigation`'s `Tree leaveAtEdges` does this for trees.
- `onFocus` reports the focused row's id for the dialog's last-focused memory; `focusSettingRow(root, id)`
  enters a section at that row, else the first.

## Blocks

- **`SettingsRow`** takes `settingId` (or a `rowId`), `label`, `description`, `control`, `sides` and
  `reset={{ changed, onReset }}`. While changed it shows a visible "Changed" tag after the label and a
  "Reset" side button (`settings-reset-<id>`, aria "Reset <label> to default"); unchanged, neither.
- **`SettingsChoice`** is a single-select `role=listbox` of `role=option` buttons (`aria-selected` on the
  applied value), `layout` segmented (←/→, `aria-orientation=horizontal`) or list/cards (↑/↓), roving
  `tabIndex` on pending ?? value. Native radios were rejected (they cannot hold focus on an unchecked
  option, WebKit Tab skips them, and arrows check natively before a pending state exists); `role=radio`
  buttons were the plan, but the lint gate's `useSemanticElements` rejects them, and a listbox whose
  selection does not follow focus is the same model. Hint mode labels `option`. `cost="cheap"` applies on each arrow; `cost="expensive"` moves a pending
  option with the visible "Press Enter to apply", applies on Enter/Space, cancels on Esc or leaving the
  group. A click — so a hint-mode press — applies at once.
- **`SettingsSlider`** is a native range over `SettingsRangeTrack`; it steps on ←/→ itself so the walk
  sees only the edges, and commits on key-up, pointer-up and blur.
- **`SettingsNumberField`** is `type=text inputMode=numeric` over `useSettingsDraft`, so ↑/↓ walk instead of
  stepping; an out-of-range draft shows "Use min–max" and is never sent.
- **`useSettingsDraft`** saves on Enter or blur. Esc reverts and prevents only when the draft differs from
  the value the host holds (or a newer in-flight save); a clean field lets Esc through to the walk. There is
  no `data-settings-draft-input` swallowing.
- **`SettingsList` / `useSettingsListRow(id)`** take the row ids; the focused row (else the first) is the
  only tab stop, its primary and sides. Enter runs the primary, Space on the primary toggles the row's
  switch, Delete (`settings.list.remove`) calls `onRemove` (the caller confirms through `ConfirmDialog`),
  Shift+F10 / the menu key calls `onMenu`.
- **`SettingsDisclosure`** is a walk row whose toggle is its stop; it opens itself when a jump targets one
  of its `settingIds`.
- **`SettingsGroup`** shows an optional visible scope tag: This workspace, This project, All projects or
  This computer.

## Jump and flash

`jumpToSetting(root, id)` waits up to 60 frames for `[data-setting-id=id]` (a section behind a skeleton),
then `revealSetting` focuses its stop (a list's first row, a tree item itself), scrolls it to the center
and sets `data-setting-flash` for `SETTING_FLASH_MS` (1.6 s). It resolves `false` when the row never
appears, and the caller focuses the section tab. Collapsed owners reveal themselves: the caller provides
the target through `SettingsJumpContext` before jumping, and `useSettingsJumpTarget()` lets a disclosure
or the Keyboard tree open the group holding it. The flash is a `primary-subtle` background keyframe in
`index.css` (no ring, so `focusUsage.test.ts` holds), held static under `prefers-reduced-motion`.
