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
binding answers to, and which chord the UI shows for it — and of the **local keys** (`localKeys.ts`), the
rebindable keys that act only while focus is inside one element. Beside the default table live the
**chord grammar** (`chord.ts`) and the **resolver** (`resolve.ts`), which folds the user's overrides and
the web extensions' commands over the table and the local declarations into the *effective* chords every
reader uses: the binder (`shell`'s
`useGlobalHotkeys`), the palette's command shortcuts, tooltips and the **shortcut catalog**
(`shortcutCatalog.ts`), the one list of every shortcut the user can press — the effective bindings plus
the keys other owners bind — that the cheatsheet and Settings → Keyboard render. `keybindingList.ts` turns
that into the editor's rows, the edits Settings → Keyboard writes and the JSON file it exports and
imports. It is pure and store-free: it matches and describes, and never handles a key or knows what a
binding does.

## Boundary

- **Public surface:** `KeybindingId`, `KeyChord`, `KEYBINDINGS`, `FOCUS_GROUP_BINDINGS`, `parseChord`,
  `formatChord`, `chordFromEvent`, `RecordedChord`, `isPlainChord`, `isLockedPrimitive`,
  `isBrowserReservedChord`, `isDesktopNativeChord`, `keybindingList`, `KeybindingList`,
  `KeybindingEntry`, `ExtensionShortcutSet`, `chordHolder`, `localChordHolder`, `assignChord`,
  `resetChord`, `keyChordLabel`, `keybindingsFile`, `planImport`, `ImportPlan`, `ImportSkipReason`,
  `elementKeyUses`, `LOCAL_SCOPES`, `AppLocalScope`, `isAppLocalScope`, `APP_LOCAL_COMMANDS`,
  `LOCAL_KEY_DEFAULTS`, `APP_LOCAL_SET`, `LocalCommandSet`, `matchLocal`, `localUses`, `globalHolder`,
  `actsIn`, `resolveKeybindings`, `ResolvedKeybindings`, `ResolvedCommand`, `ResolvedChord`,
  `KeybindingConflict`, `ExtensionCommandSet`, `matchKeybinding`, `pressesChord`, `keybindingShortcut`,
  `keybindingShortcuts`, `keybindingKeys`, `keybindingLabel`, `keybindingLabels`, `SHORTCUT_CATALOG`,
  `SHORTCUT_SURFACES`, `SHORTCUT_SURFACE_TITLES`, `ShortcutSurface`, `ShortcutRow`,
  `ShortcutConflictView`, `shortcutRows`, `shortcutKeyCaps`, `DESKTOP_KEYS`.
- **Allowed deps:** `contracts` (the shared chord shape check `isKeybindingChord`, `isModifierKeyCode`,
  `KEYBINDING_MODIFIERS`), `commands` (`CommandShortcut` and `shortcutKeys`), `lib` (`platformFamily`),
  `@thinkrail/ui/keyboard` (the pure chord primitives `chordPressed`, `keyCap`, `codeLabel`,
  `isTypingChord` and the arrow twins, shared with the local-keys seam so matching cannot drift),
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
  [[module-desktop]]; the palette's zoom rows only show them), the double-Shift gesture, the locked
  navigation keys elements handle themselves (Monaco, xterm, arrows, Enter, Esc, Tab), and an extension's
  in-mode keys (`shortcuts`, display only). The catalog lists them; it binds none, and none is
  rebindable. Local keys are declared here but matched by their element (*Local keys*).

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
- **A plain chord** has no `Mod`/`Ctrl`/`Alt` and is not `F1`–`F12` (Shift alone is plain). A global
  plain chord matches only outside text entry, and only a global command whose default has one may hold
  one (hint mode's `F`); the resolver drops a plain override on any other global command. Every local
  command may hold one.
- **A locked primitive** (`isLockedPrimitive`) is an arrow, Enter, Escape, Tab, Space, Home/End or
  PgUp/PgDn with no modifier or Shift alone — the keys browsers, screen readers and ARIA patterns expect.
  The resolver drops one from any override unless it is that command's own default (the card's
  `Shift+Escape` skip may be re-recorded); the Enter-based chords (`Mod+Enter`, `Alt+Enter`,
  `Mod+Shift+Enter`) are not primitives and rebind like any chord.
- **`chordFromEvent(event, platform, { allowPlain, allowLocked })`** records a press by `code`: ⌘ → `Mod`, ⌃ → `Ctrl`
  on Apple, Control → `Mod` elsewhere. It rejects a modifier on its own (`modifierOnly`), a plain chord
  unless `allowPlain` (`plain`), a locked primitive unless `allowLocked` (`locked`, carrying the chord so
  the editor can accept a command's own default), ignores an AltGraph press and the Windows/Super key off Apple (no chord
  names them) and any code outside the grammar, and flags a browser-reserved chord as a warning
  (`browserReserved: true`), never a rejection — it works in the desktop app.
- **Desktop-native chords are never recordable** (`isDesktopNativeChord`): the desktop's own close, quit
  and Settings (`Mod+W`, `Mod+Q`, `Mod+,`, and `Mod+F4` off Apple, mirroring `shell/shortcutCommands.ts`),
  the macOS menu's hide / hide others / minimize, and page zoom (`Mod+=`, `Mod+Shift+=`, `Mod+-`,
  `Mod+Numpad+`/`-`/`0`). One override set serves every OS, so a chord native on either family is
  refused, compared by the physical keys each holds (`Ctrl+KeyW` is Linux's close). `chordFromEvent` stays
  platform-neutral and does not refuse them; the editor and `planImport` do, and the resolver reserves
  them (*Resolver*), so a hand-edited config cannot bind one either. Each names the catalog row that shows
  it (`desktop.quit`, `desktop.zoomIn`, `Mod+W` → `tab.close`). No matchable default is native (tested);
  `tab.close`'s display-only `Mod+W` is.
- **The list compares US positions, but `shortcutCommands` matches typed characters** (AZERTY's Ctrl+W
  is `KeyZ`, Russian Ctrl+, is `Shift+Slash`), so `shell` closes the gap from the event: the editor also
  refuses a press that matcher owns on the current layout, and the binder yields such a press to it
  ([[submodule-web-shell]], *Native shortcuts*). Page zoom matches typed characters too, but the preload
  yields any key the page claimed, so a chord bound over a zoom character takes the press instead of
  zooming (one owner, like `Mod+0`) and is not refused.

## Local keys

- **A local command** is `{ id, scope, chords }` acting only while focus is inside its element. The app
  declares them in `localKeys.ts` (`APP_LOCAL_COMMANDS`, ids `<scope>.<action>`, one direction per
  command) under `LOCAL_SCOPES` — `tabs`, `rails`, `trees`, `review`, `review.surface`, `transcript`,
  `composer`, `history`, `palette`, `findInFiles`, each titled for the editor (`where`, `inside`). An
  extension command with a `scope` is local too ([[module-extension-api]]); its id and scope must start
  with `<extension name>.`, and the resolver drops any extension command, global or local, that does not
  (so none can shadow `trees.search` or `search.open`). Resource renderers add their own set:
  `shell` resolves `REVIEW_SURFACE_COMMANDS` ([[module-resource-renderers]]) as a ThinkRail set in scope
  `review.surface`, whose `review.comment` / `review.saveDraft` / `review.sendNow` catalog rows are
  `local` rows (the comment row behind a locked ↵).
- **Shared scope `arrows`.** The letter twins of the arrows (`arrows.left/down/up/right`, H/J/K/L by
  `code`) are `@thinkrail/ui/keyboard`'s `ARROW_TWIN_COMMANDS`, declared once in scope `arrows`; `tabs`,
  `rails`, `trees`, `review.surface` and `transcript` include it, so one rebind applies in every element.
  A scope another includes is not an element of its own: it never appears in the `local` map.
- **Physical keys everywhere:** local letters match `code` (caps show US positions; Dvorak and Colemak
  users rebind). A typing local chord (no Mod/Ctrl/Alt, not Escape, not an F-key — `isTypingChord`)
  never matches in text entry; `Shift+Escape` or `Mod+Enter` still do.
- **Ranking per effective scope** (own commands plus included ones): override > ThinkRail > extension,
  then own before included, then declaration order. An own command losing in its scope is `lostTo` the
  winner; an included command losing there is listed in `lostIn` (`{ scope, winner }`) and keeps acting
  in every other element. Desktop-native and dictation reservations take a local chord first, as they
  take a global one. Local chords never conflict with global ones: inside its element the local key wins
  (the binder yields, [[submodule-web-shell]]), so a global default never equals a local default — a
  tested invariant beside "no default conflict in any effective scope".
- **Outputs:** `ResolvedCommand.scope` (null for global), `conflicts[].scope`, and `local` — effective
  scope → active chords in rank order, one entry per element even when empty, so a scope whose every key
  was unbound matches nothing instead of its defaults. `matchLocal(resolved, scopes, event, { textEntry })`
  tries the focused element's scopes innermost first. `localUses(resolved, chord)` (every element holding
  a chord), `globalHolder(resolved, chord)` and `actsIn(resolved, scope)` (the elements a scope's
  commands act in) feed the editor's warnings.
- **`LOCAL_KEY_DEFAULTS[scope]`** is a scope's declared commands plus its included ones, the defaults a
  handler hands `useLocalKeys`; with no provider those match. Every element key handler matches through
  it — trees, Changes review, transcript, composer, history, tab strips, rails, palette, Find in Files —
  and shows its caps and `aria-keyshortcuts` from the same hook, so a rebind acts and shows at once. The
  per-feature typed-key constants (`TAB_KEYS` … `HISTORY_KEYS`) were deleted with that migration;
  `DESKTOP_KEYS` stays (display only).

## Resolver

- **`resolveKeybindings({ platform, overrides, extensions, local })`** takes the table, the commands of every
  registered web extension in registry order with an `enabled` flag (`ExtensionCommandSet`), the local
  command sets (`LocalCommandSet`, default `[APP_LOCAL_SET]`), and the
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
  Settings → Extensions order). **The losing chord is inactive for its loser only** — its other chords
  still work — and is reported as a conflict.
  An override onto another command's default leaves that command losing the chord; an editor that wants
  it gone writes an explicit unbind. **A disabled extension's commands are listed but neither match nor
  conflict**, its overrides included.
- **Reserved chords are owned before ranking**: a display-only table chord by its command, and a chord
  bound outside the table — the desktop-native list above and dictation's fixed `Mod+Shift+Space`
  (`speech/hotkey.ts`, a second window listener) — by its catalog row. Any other command's chord there
  never matches and is a conflict with that owner as winner, so the editor and the cheatsheet mark it
  "taken by …": an override on either OS (the editor's rule), a default on this one. Ranked as an
  override, `search.open: ["Mod+KeyW"]` took `Mod+W` and fired beside `shortcutCommands`' close. A
  command's own reserved chord (a hand-written `tab.close: ["Mod+KeyW"]`) is shown and never matched, as
  its default is. Only the desktop-native ones are refused up front; dictation's records, then shows lost.
- **The typed `?` also holds its US position `Mod+Shift+Slash`** wherever conflicts are found (here,
  `chordHolder`, `planImport`), since that press types it: an override on it wins and leaves
  `shortcuts.open` unbound on every layout, marked lost. Matching is unchanged.
- The default table resolves with no conflict on any platform, and the bundled extensions add none
  (`extensions`' tests).
- **Each command reports its defaults on this platform** (`ResolvedCommand.defaults`), which the editor
  compares a recording with and the file exports.
- **Readers are reactive.** The app never reads `KEYBINDINGS` to show or match a chord: `shell` resolves
  once per change of the overrides or the switched-off extensions (`keybindingState.ts`,
  [[submodule-web-shell]]) and every tooltip, palette row, cheatsheet row and the binder reads that
  result, so a rebind shows everywhere at once.

## Shortcut catalog

- **One entry per shortcut**, `{ id, title, surface, scope? }` plus either `bindings` (table ids — the chord is
  the resolved `keybindingShortcut`'s, never restated, and a browser therefore lists no chord it never
  receives: `Mod+Alt+N` / `Mod+Alt+W`, not `Mod+N` / `Mod+W`), `local` (a local command id, optionally
  after a locked `keys` prefix such as a comment's ↵) or `keys` (display chords for everything bound
  elsewhere). A direction row is `keys` with one arrow plus `twin` (its `arrows.*` command, `shift` for a
  selection-extending row): it shows the arrow locked and the twin's resolved letters, struck through
  where the element took the letter over. Rows that bundled two directions are split into one row per
  direction. `scope` groups element rows under their caption; every app local command has a titled row
  (tested). A `keys` chord's `key` is the `KeyboardEvent.key` value (`ArrowDown`, `v`, `F2`), rendered
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
- **Feature handlers keep their matching** (the table never dispatches feature keys): each element
  handler matches its local keys through `useLocalKeys`, so the listed and the handled key cannot drift;
  the palette's zoom and Settings shortcuts read `DESKTOP_KEYS`. Locked keys stay literal in their
  handler and are display entries only (hint mode's in-mode keys, Monaco's own `Shift+Mod+M`).
- **Review surface keys.** The diff line cursor, the Markdown block cursor, the region frame, the swipe
  divider, the review composer and draft cards live in `@thinkrail/resource-renderers`, which cannot
  import the app, so the package declares its rebindable keys (`REVIEW_SURFACE_COMMANDS`) and matches them
  through the same `useLocalKeys` seam ([[module-resource-renderers]], *Keyboard review surfaces*); the
  Changes review section lists them as `local` rows and the locked cursor keys as display entries
  (`review.cursorUp` … `review.swipeFar`).
- **Extension rows.** After the catalog, `shortcutRows` lists every enabled extension command, global or
  local, from the resolved table as a General row with all its active chords (hint mode's `F` and `Mod+;`), then the
  `extra` entries: `shell` passes the `shortcuts` (in-mode, display-only keys) of every enabled web
  extension ([[submodule-web-extensions]]). The catalog never imports an extension, and a switched-off
  one's rows disappear. `extensions`' tests pin that plain `F` is bound nowhere in the table or the
  catalog's feature keys.
- Tested: every `KeybindingId` belongs to a titled entry, ids are unique, every title is an English key.

## Editor rows and edits

- **`keybindingList({ desktop, keybindings, extensions })`** is the one row list Settings → Keyboard and
  the JSON file share, so the file has exactly the editor's rows: the catalog grouped by surface
  (`desktop` rows only where the native bridge exists), one row per binding of a multi-binding entry
  (the focus groups, titled `bindingTitle` with their `position`), then per web extension in registry order
  its commands and its `shortcuts` (switched-off ones included, `active: false`). A `bindings` or `local`
  row is editable; a `keys` row is `locked` with its display chords. A row has an `id` (unique) and the
  `command` an edit writes — different only on a direction row, which edits its shared twin — plus its
  `scope`, the locked `fixed` prefix, and `yields`: where a local key takes the row's chord over inside an
  element (a global row's chord that a local holds, a twin's letter an element took). Each chord carries its grammar text (a typed
  default its display form, `Mod+?`), caps, `lostTo` and `shown` — false for a browser-reserved chord
  while another active one remains in a browser, the rule `keybindingShortcut` follows.
- **`chordHolder(list, command, chord)`** is the command another active chord belongs to (enabled
  commands only, compared by physical keys; `Mod+Shift+Slash` is the cheatsheet's while its `?` is
  active) — for a local target only inside the elements it acts in (`localChordHolder` also names that
  element), so a key used in another element is no conflict — and none for a disabled target, which conflicts with nothing: its override is saved alone and
  ranked by the resolver once the extension is on, where, as an override, it takes the chord and the
  other command shows it lost.
  **`assignChord(list, overrides, command, chord, replace)`** writes the override — none when the chord
  equals the command's defaults less display-only chords — and, with `replace` (ignored for a disabled
  target), an explicit
  override for that command: its chords less display-only and typed ones, minus this chord, `[]` when
  nothing remains (normalised the same way). The resolver's priority alone would
  leave a lower-ranked holder losing the chord, so Replace never relies on it — except against a shared
  twin inside the element that includes it: the element's own override always outranks it there, and an
  unbind would take the letter from every other element too, so Replace leaves the twin `lostIn` that
  element only. **`resetChord`** drops one
  override.
- **`elementKeyUses({key, shift}, platform)`** lists the locked catalog `keys` rows that act on a press's
  **typed** key (`event.key`, Shift allowed; F-keys and named keys included), only for the plain-command
  warning: rebindable element keys are local commands, which `localUses` reports by physical key.

## Keybindings file

- **Export** (`keybindingsFile(list, title)`): `{ "format": "thinkrail-keybindings", "version": 1,
  "bindings": [...] }`, one entry per list row in its order. A command: `{ command, title (English),
  source: "thinkrail" | <extension>, chords, defaults, changed }` with grammar strings (all of its
  chords on this platform, lost and display-only ones included; a typed default as its display form). A
  local row adds `scope`, a direction row `alias` (the twin it edits) and `fixed: { keys, locked: true }`
  (still version 1: additive). A locked row: `{ command, title, source, scope?, locked: true, keys }` with
  display labels. A switched-off
  extension's entries add `active: false`; a command whose chord loses adds `conflict: { chord, winner }`
  (its first lost chord).
- **Import** (`planImport(overrides, list, file)`) returns `null` for anything but a version-1 file of that
  format, else `{ changes, conflicts, skipped, unchanged, overrides }` — `overrides` the merged map the
  editor sends as one `settings.update`. Per entry, by `command`: a locked row (or any catalog `keys` id)
  is skipped as `locked`; an id the list lacks (an extension not installed), or a repeat, as `unknown`;
  `chords` not a string list, or a chord outside the grammar, as `invalid`; a plain chord on a non-plain
  global command as `plain`; a locked primitive that is not the command's own default as `primitive`; a
  desktop-native chord as `desktop`. A direction row imports into its twin; a later row for the same
  twin with the same chords counts as unchanged, with others as a repeat. Chords equal to the row's current chords are
  `unchanged`; chords equal to its defaults — this platform's or the entry's own `defaults`, so a file
  from another OS keeps the defaults, and `"Mod+?"` reads as the cheatsheet's default — mean "defaults"
  (unchanged unless the command was custom). A switched-off extension's commands import too.
- **Import conflicts:** an imported chord another enabled command holds actively (`chordHolder`'s rule,
  so local ones only within their elements, each conflict carrying that `scope`) goes to the import, and
  that command loses it through the same explicit override Replace writes (a shared twin, as with
  Replace, only loses inside that element); a command the file also changes is not a conflict (its own
  entry decides). Self-conflicting entries are left to the resolver.
