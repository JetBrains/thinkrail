---
id: submodule-web-keybindings
type: submodule-design
status: draft
title: keybindings — the app-wide chord table
parent: module-web
references: [submodule-web-commands, submodule-web-shell]
tags: [ui, keyboard, public-surface-checked]
---

## Responsibility

The one declaration of the web app's app-wide chords: which physical keys and modifiers each named
binding answers to, and which chord the UI shows for it. The binder (`shell`'s `useGlobalHotkeys`) and
the palette's command shortcuts both read this table, so a chord is written once. It is pure and
store-free: it matches and describes, and never handles a key or knows what a binding does.

## Boundary

- **Public surface:** `KeybindingId`, `KEYBINDINGS`, `FOCUS_GROUP_BINDINGS`, `matchKeybinding`,
  `keybindingShortcut`, `keybindingLabel`, `keybindingLabels`.
- **Allowed deps:** `commands` (`CommandShortcut` and `shortcutKeys`), `lib` (`platformFamily`).
- **Forbidden:** importing `store`, `transport`, `shell`, `panels`, `chat`, `search` or React; reading
  globals to decide what to show (the caller passes `browser`); binding a key — the handlers, gating
  (modal, availability, repeat, terminal) and capture-phase listener stay `shell`'s.

## Contract

- **Ids** are dotted and match the palette command id where one exists (`view.toggleLeft`,
  `workspace.new`, `files.findInFiles`, `chat.history`, `region.next`, `focus.composer`, `view.changes`,
  `focus.group1`…, and the active-tab commands `tab.close`, `group.splitRight`,
  `tab.moveToPreviousGroup` / `tab.moveToNextGroup`, which are also the workbench's tab-action ids);
  `search.open` has no palette row, and `view.files` is shown by the older `view.show.files` row.
- **Tab chords** (VS Code's keymap; [[submodule-web-shell]], *Global chords*, owns what they do):
  `tab.close` is `Mod+W` (display-only) and `Mod+Alt+W`, `group.splitRight` is `Mod+\` (`Backslash`),
  and the group moves are `⌃⌘←` / `⌃⌘→` on Apple and `Ctrl+Alt+←` / `Ctrl+Alt+→` elsewhere (`Mod+Alt`
  would collide with the Mac browsers' tab switching).
- **Region and focus chords:** `region.next` `F6` and `region.previous` `Shift+F6` (no modifier, so
  `Ctrl+F6` stays the workbench's group cycling), `focus.composer` `Mod+L`, `focus.projects` `Mod+0`,
  `focus.group1…9` `Mod+1…9` (`FOCUS_GROUP_BINDINGS` lists them in group order), `focus.terminal`
  `` Ctrl+` ``, `view.files` `Mod+Shift+E`, `view.changes` `Mod+Shift+G` ([[submodule-web-shell]],
  *Global chords*, owns what they do). The digits are `Digit0`…`Digit9`: `Numpad0` never matches `focus.projects`, so `Mod+Numpad0` keeps
  resetting desktop page zoom while `Mod+0` moves focus. `` Ctrl+` `` is `Backquote` with literal Control
  on every platform, like `Ctrl+R` (`` ⌃` `` on a Mac, where `` Cmd+` `` stays the system's window cycling).
- **A chord matches on physical `KeyboardEvent.code`**, never the layout-dependent `key`; `key` is only
  the label `CommandShortcut` renders. Modifiers are exact: `mod` is ⌘ on Apple and Ctrl elsewhere
  (`platformFamily`, the same rule as `hasPlatformModifier`), `ctrl` is literal Control on every platform
  (`Ctrl+R` is ⌃R on a Mac), and a modifier the chord does not name must be up. Tolerating a modifier
  means listing a second chord — `workspace.new` is `Mod+N` and `Mod+Alt+N`. Alt belongs only to that
  alias, `tab.close`'s `Mod+Alt+W` and the non-Apple group moves (a tested list). **No Alt chord matches
  while AltGraph is held** (`getModifierState("AltGraph")`): Windows reports AltGr as Ctrl+Alt, so a
  layout's AltGr character must never fire `Mod+Alt+N`, `Mod+Alt+W` or a group move.
- **A chord may name a `platform`** (`apple` / `other`): it matches and is shown only on that family,
  so one binding is `⌃⌘←` on a Mac and `Ctrl+Alt+←` elsewhere. **A `displayOnly` chord is shown but never
  matched:** `Mod+W` closes a tab on the desktop, but the native menu (macOS) and `shortcutCommands`
  (Windows/Linux) own it — binding it here too would close twice from the two window listeners, and in
  a browser the page never receives it.
- **No two bindings share a chord on any platform**, display-only chords included, so
  `matchKeybinding` returns at most one id and table order never decides a match. A tested invariant.
- **The shown chord is the first chord of the platform** (`keybindingShortcut(id, { browser, platform })`),
  except that `browser: true` skips a `browserReserved` one: browsers keep Cmd/Ctrl+N for a new window
  and Cmd/Ctrl+W for closing the browser tab and never deliver them, so a browser tab advertises
  `Mod+Alt+N` / `Mod+Alt+W` while the desktop webview advertises `Mod+N` / `Mod+W`. `Mod+N` and its alias
  both match everywhere; `Mod+W` never matches here.
- **Labels** for tooltips and prose (`⌘K`, `Ctrl+K`, `⌥⌘N`, `Ctrl+Alt+N`) come from `keybindingLabel`
  (the shown chord) and `keybindingLabels` (every chord of the platform, table order), joining
  `shortcutKeys`'s caps, so chrome that names a table chord never spells it by hand.
- **IME:** the binder ignores every table chord while `event.isComposing`, so an input method keeps its
  keys; only `Ctrl+R`'s reload guard still swallows the key.
- **Not here:** `shell/shortcutCommands.ts` (close/quit/settings — native-owned and typed-key matched on
  purpose; `tab.close` only shows its `Mod+W`), the desktop page-zoom chords `Mod+=` / `Mod+-` / `Mod+Numpad0` (the preload binds them,
  [[module-desktop]]; the palette's zoom rows only show them), the double-Shift gesture, and
  feature-local keys (the palette's own `Mod+K` / `Mod+I`, Monaco, xterm). User rebinding, when it
  comes, is an override map over `KEYBINDINGS`.
