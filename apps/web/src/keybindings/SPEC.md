---
id: submodule-web-keybindings
type: submodule-design
status: draft
title: keybindings — the app-wide chord table and the shortcut catalog
parent: module-web
references: [submodule-web-commands, submodule-web-shell]
tags: [ui, keyboard, public-surface-checked]
---

## Responsibility

The one declaration of the web app's app-wide chords: which physical keys and modifiers each named
binding answers to, and which chord the UI shows for it. Beside the default table live the **chord
grammar** (`chord.ts`) and the **resolver** (`resolve.ts`), which folds the user's overrides and the web
extensions' commands over the table into the *effective* chords every reader uses: the binder (`shell`'s
`useGlobalHotkeys`), the palette's command shortcuts, tooltips and the **shortcut catalog**
(`shortcutCatalog.ts`), the one list of every shortcut the user can press — the effective bindings plus
the keys other owners bind — that the cheatsheet and Settings → Keyboard render. It is pure and
store-free: it matches and describes, and never handles a key or knows what a binding does.

## Boundary

- **Public surface:** `KeybindingId`, `KeyChord`, `KEYBINDINGS`, `FOCUS_GROUP_BINDINGS`, `parseChord`,
  `formatChord`, `chordFromEvent`, `RecordedChord`, `isPlainChord`, `isBrowserReservedChord`,
  `resolveKeybindings`, `ResolvedKeybindings`, `ResolvedCommand`, `ResolvedChord`, `KeybindingConflict`,
  `ExtensionCommandSet`, `matchKeybinding`, `keybindingShortcut`, `keybindingShortcuts`,
  `keybindingKeys`, `keybindingLabel`, `keybindingLabels`, `SHORTCUT_CATALOG`, `SHORTCUT_SURFACES`,
  `SHORTCUT_SURFACE_TITLES`, `ShortcutSurface`, `ShortcutRow`, `ShortcutConflictView`, `shortcutRows`,
  `shortcutKeyCaps`, `TAB_KEYS`, `RAIL_KEYS`, `HJKL_KEYS`, `TREE_KEYS`, `REVIEW_KEYS`,
  `TRANSCRIPT_KEYS`, `HISTORY_KEYS`, `DESKTOP_KEYS`.
- **Allowed deps:** `contracts` (the shared chord shape check `isKeybindingChord`, `isModifierKeyCode`,
  `KEYBINDING_MODIFIERS`), `commands` (`CommandShortcut` and `shortcutKeys`), `lib` (`platformFamily`),
  `@thinkrail/locales` (the catalog's `MessageKey` titles, type-only).
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
  `focus.group1…9` `Mod+1…9` (`FOCUS_GROUP_BINDINGS` lists them in group order), `shortcuts.open`
  `Mod+?` (the cheatsheet, [[submodule-web-shell]]), `focus.terminal`
  `` Ctrl+` ``, `view.files` `Mod+Shift+E`, `view.changes` `Mod+Shift+G` ([[submodule-web-shell]],
  *Global chords*, owns what they do). The digits are `Digit0`…`Digit9`: `Numpad0` never matches `focus.projects`, so `Mod+Numpad0` keeps
  resetting desktop page zoom while `Mod+0` moves focus. `` Ctrl+` `` is `Backquote` with literal Control
  on every platform, like `Ctrl+R` (`` ⌃` `` on a Mac, where `` Cmd+` `` stays the system's window cycling).
- **A chord matches on physical `KeyboardEvent.code`**, never the layout-dependent `key`; `key` is only
  the label `CommandShortcut` renders. **The one exception is `shortcuts.open`, a `typed` chord**: it
  matches `key === "?"` with Mod, Alt up and Shift ignored. `?` sits on a different physical key per
  layout (US `Shift+/`, Russian `Shift+7`, German `Shift+ß`), and the US `Slash` position would type
  `,` on a Russian layout — `Ctrl+,`, the desktop's Settings (`shortcutCommands`, matched by character)
  — and `-` on a German one, the desktop's zoom-out. macOS browsers keep `⌘⇧/` for Help-menu search, so
  there the icon and the palette row open the cheatsheet; the chord is still shown (accepted). Modifiers are exact: `mod` is ⌘ on Apple and Ctrl elsewhere
  (`platformFamily`, the same rule as `hasPlatformModifier`), `ctrl` is literal Control on every platform
  (`Ctrl+R` is ⌃R on a Mac), and a modifier the chord does not name must be up. Tolerating a modifier
  means listing a second chord — `workspace.new` is `Mod+N` and `Mod+Alt+N`. Alt belongs only to that
  alias, `tab.close`'s `Mod+Alt+W` and the non-Apple group moves (a tested list). **Off Apple, no Alt
  chord matches while AltGraph is held** (`getModifierState("AltGraph")`): Windows reports AltGr as
  Ctrl+Alt, so a layout's AltGr character must never fire `Mod+Alt+N`, `Mod+Alt+W` or a group move. On a
  Mac the guard does not apply — Firefox reports Option as AltGraph, and `Mod` is ⌘, so there is no AltGr
  ambiguity (xterm.js limits its AltGraph check to Windows for the same reason).
- **A chord may name a `platform`** (`apple` / `other`): it matches and is shown only on that family,
  so one binding is `⌃⌘←` on a Mac and `Ctrl+Alt+←` elsewhere. **A `displayOnly` chord is shown but never
  matched:** `Mod+W` closes a tab on the desktop, but the native menu (macOS) and `shortcutCommands`
  (Windows/Linux) own it — binding it here too would close twice from the two window listeners, and in
  a browser the page never receives it.
- **No two default bindings share a chord on any platform**, display-only chords included, so the
  default table resolves with no conflict and table order never decides a default match. A tested
  invariant; a shared chord can only come from an override or an extension and is ranked by the resolver.
- **The shown chord is the first active chord of the command** (`keybindingShortcut(resolved, id, {
  browser })`), except that `browser: true` skips a browser-reserved one while another remains: browsers
  keep Cmd/Ctrl+N for a new window and Cmd/Ctrl+W for closing the browser tab and never deliver them, so a
  browser tab advertises `Mod+Alt+N` / `Mod+Alt+W` while the desktop webview advertises `Mod+N` / `Mod+W`.
  `Mod+N` and its alias both match everywhere; `Mod+W` never matches here. The reserved set is one list
  (`isBrowserReservedChord`): `Mod+T`, `Mod+N`, `Mod+W`, `Mod+Q`, `Mod+Tab`, `Mod+Shift+Tab`,
  `Mod+Shift+T`, `Mod+Shift+N`, `Mod+Shift+W`; the table carries no per-chord flag. An unbound command, or
  one whose every chord lost, shows nothing (`undefined`, no caps, an empty label).
- **Labels** for tooltips and prose (`⌘K`, `Ctrl+K`, `⌥⌘N`, `Ctrl+Alt+N`) come from `keybindingLabel`
  (the shown chord) and `keybindingLabels` (every active chord, in the command's order), joining
  `shortcutKeys`'s caps, so chrome that names a chord never spells it by hand.
- **IME:** the binder ignores every app chord while `event.isComposing`, and every extension command
  while composing or on the 229 sentinel (`isImeComposing`, hint mode's former rule), so an input method
  keeps its keys; only `Ctrl+R`'s reload guard still swallows the key.
- **Not bound here:** `shell/shortcutCommands.ts` (close/quit/settings — native-owned and typed-key matched on
  purpose; `tab.close` only shows its `Mod+W`), the desktop page-zoom chords `Mod+=` / `Mod+-` / `Mod+Numpad0` (the preload binds them,
  [[module-desktop]]; the palette's zoom rows only show them), the double-Shift gesture, and
  feature-local keys (the palette's own `Mod+K` / `Mod+I`, Monaco, xterm), and an extension's in-mode
  keys (`shortcuts`, display only). The catalog lists them; it binds none, and none is rebindable.

## Chord grammar

- **One string form** for stored and exported chords: modifiers in the fixed order `Mod`, `Ctrl`, `Alt`,
  `Shift`, then the key's `KeyboardEvent.code`, joined by `+` — `Mod+Alt+KeyS`, `Ctrl+Alt+ArrowLeft`,
  `F6`, `Mod+Semicolon`, `Mod+Backslash`. `contracts`' `isKeybindingChord` is the shape check the host
  validates with; `parseChord` turns a valid string into a physical `KeyChord` (its display `key` is the
  code's US label, `KeyS` → `S`, `ArrowLeft` → `←`) and `formatChord` writes it back canonically, so
  `formatChord(parseChord(s)) === s`. A modifier key, an unknown or out-of-order modifier, or a typed
  character is not a chord.
- **`Mod` is ⌘ on Apple and Ctrl elsewhere; a literal `Ctrl` is ⌃ on Apple and the same key as `Mod`
  elsewhere**, so one override set serves every OS. Equality is by the physical modifiers a platform
  holds (`chordSignature`): `Ctrl+KeyU` and `Mod+KeyU` are one chord off Apple, two on a Mac.
- **A plain chord** has no `Mod`/`Ctrl`/`Alt` and is not `F1`–`F12` (Shift alone is plain). It matches only
  outside text entry, and only a command whose default has one may hold one (hint mode's `F`); the
  resolver drops a plain override on any other command.
- **`chordFromEvent(event, platform, { allowPlain })`** records a press by `code`: ⌘ → `Mod`, ⌃ → `Ctrl`
  on Apple, Control → `Mod` elsewhere. It rejects a modifier on its own (`modifierOnly`) and a plain chord
  unless `allowPlain` (`plain`), ignores an AltGraph press and the Windows/Super key off Apple (no chord
  names them) and any code outside the grammar, and flags a browser-reserved chord as a warning
  (`browserReserved: true`), never a rejection — it works in the desktop app.

## Resolver

- **`resolveKeybindings({ platform, overrides, extensions })`** takes the table, the commands of every
  registered web extension in registry order with an `enabled` flag (`ExtensionCommandSet`), and the
  user's override map (`AppConfig.keybindings`: command id → chords, `[]` unbound, absent = defaults). It
  returns every command — app ones in table order, then extension ones, each with `extension`, `enabled`,
  `custom` (overridden), `plain` and its chords on this platform, each `lostTo` the winner or `null` —
  the conflicts `{ loser, chord, winner }`, and the active chords `matchKeybinding(resolved, event, {
  textEntry })` matches in rank order.
- **An override replaces the command's defaults on every platform** (platform-scoped defaults apply only
  when it is not overridden); malformed chords, plain chords on a non-plain command and duplicates are
  dropped; an override for an unknown id is ignored (the host keeps it — the extension may be off or
  missing). An extension default outside the grammar is dropped and a duplicate command id ignored.
- **Priority** for a shared chord: a user override beats ThinkRail defaults, which beat extension
  defaults; within a rank, ThinkRail commands in table order, then extensions in registry order (the
  Settings → Extensions order). A display-only chord occupies its chord without matching. **The losing
  chord is inactive for its loser only** — its other chords still work — and is reported as a conflict.
  An override onto another command's default leaves that command losing the chord; an editor that wants
  it gone writes an explicit unbind. **A disabled extension's commands are listed but neither match nor
  conflict**, its overrides included.
- The default table resolves with no conflict on any platform, and the bundled extensions add none
  (`extensions`' tests).
- **Readers are reactive.** The app never reads `KEYBINDINGS` to show or match a chord: `shell` resolves
  once per change of the overrides or the switched-off extensions (`keybindingState.ts`,
  [[submodule-web-shell]]) and every tooltip, palette row, cheatsheet row and the binder reads that
  result, so a rebind shows everywhere at once.

## Shortcut catalog

- **One entry per shortcut**, `{ id, title, surface }` plus either `bindings` (table ids — the chord is
  the resolved `keybindingShortcut`'s, never restated, and a browser therefore lists no chord it never
  receives: `Mod+Alt+N` / `Mod+Alt+W`, not `Mod+N` / `Mod+W`) or `keys` (display chords for everything
  bound elsewhere). A `keys` chord's `key` is the `KeyboardEvent.key` value (`ArrowDown`, `v`, `F2`), rendered
  as a cap (`↓`, `V`); it may name a `platform` (`apple`, `other` = not Apple, `linux`), and an entry
  marked `desktop` (native menu, `shortcutCommands`, page zoom) is listed only where the native shortcut
  bridge exists. The focus-group bindings are one row shown as a range (`⌘1–9`) while all nine are at
  their defaults, else as each one's chord.
- **Surfaces** are a fixed ordered set — general, tabs and groups, panels and tool rails, sidebar trees,
  Changes review, chat input, chat transcript, chat history, search palette, Find in Files, terminal,
  desktop app — each titled by a locale key; `shortcutRows({ desktop, keybindings })` resolves the catalog
  for one client into rows of caps and a text label (what the filter matches), plus each row's
  `conflicts` (a losing chord and its winner, for the editor's marks; a row with neither chords nor
  conflicts — an unbound command — is left out).
- **Feature handlers keep their matching** (the table never dispatches feature keys) but read the key
  they compare from the catalog's constants — the tab strip and rails (`TAB_KEYS`, `RAIL_KEYS`), the
  sidebar trees (`TREE_KEYS`: `S` search, `F2`, `Delete`, `Mod+Enter`, project reorder), Changes review
  (`REVIEW_KEYS`: `V` `J` `N` `P`, `Alt+↑/↓`), the chat transcript and the composer's way into it
  (`TRANSCRIPT_KEYS`: `Mod+↑`, `C`, `O`), the history overlay's entry delete (`HISTORY_KEYS`), and the
  letter twins of the arrows (`HJKL_KEYS`: h/j/k/l, shared by the transcript, tab strips, rails and
  sidebar trees) — so
  the listed and the handled key cannot drift; the palette's zoom and Settings shortcuts read
  `DESKTOP_KEYS`. Keys that stay literal in their handler (composer, palette, Find in Files, xterm,
  dictation, the transcript's arrows and the history overlay's other keys) are display entries only.
- **Review surface keys are display entries too.** The diff line cursor, the Markdown block cursor, the
  region frame, the swipe divider, the review composer and draft cards live in
  `@thinkrail/resource-renderers`, which cannot import the app, so their handler reads its own
  `support/cursorKeys.ts` ([[module-resource-renderers]], *Keyboard review surfaces*) and the Changes
  review section lists the same chords (`review.cursorMove` … `review.swipeFar`). Moving them into
  `@thinkrail/ui` would make the primitives package own one feature's key map, so they stay where they
  are handled.
- **Extension rows.** After the catalog, `shortcutRows` lists every enabled extension command from the
  resolved table as a General row with all its active chords (hint mode's `F` and `Mod+;`), then the
  `extra` entries: `shell` passes the `shortcuts` (in-mode, display-only keys) of every enabled web
  extension ([[submodule-web-extensions]]). The catalog never imports an extension, and a switched-off
  one's rows disappear. `extensions`' tests pin that plain `F` is bound nowhere in the table or the
  catalog's feature keys.
- Tested: every `KeybindingId` belongs to a titled entry, ids are unique, every title is an English key.
