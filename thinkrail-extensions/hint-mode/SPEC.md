---
id: module-ext-hint-mode
type: module-design
status: active
title: Hint mode extension
parent: module-thinkrail-extensions
depends-on: [module-ui, module-extension-api, module-locales]
references: [submodule-web-shell, submodule-web-keybindings, module-browser-e2e]
tags: [extensions, keyboard]
---

## Responsibility

Vimium-style hint mode: one key labels everything clickable in the window, typing a label presses it.
It is the first **web-only** ThinkRail extension — no pi capability, no server half — and the first
consumer of the web SDK's global contribution points ([[module-extension-api]]). On by default; Settings →
Extensions switches it off, and the host then unmounts it, so no key does anything.

## Boundary

`@thinkrail/ext-hint-mode/web` default-exports
`defineWebExtension({ name: "hint-mode", title, description, globalOverlay: HintMode, shortcuts })` and
nothing else. It imports `extension-api/web` (types), `@thinkrail/ui/keyboard` (`hasPlatformModifier`,
`isImeComposing`, `isApplePlatform`), `@thinkrail/ui/keycaps`, `@thinkrail/locales/react` (`hintMode.*`
keys), React and `react-dom` (`createPortal`). Everything host-shaped arrives through `GlobalOverlayProps`:
`isTextEntry(target)` (the app's text-entry rule: fields, contenteditable, Monaco, xterm), `activeLayer()`
(the topmost open modal dialog or menu, else the document) and `platform`.

## Keys

The overlay owns one window **capture** `keydown` listener, so it runs before Radix (document) and the
app's bubbling handlers; every key it handles is `preventDefault` + `stopImmediatePropagation`.

- **Start:** `KeyF` with no modifier when `composedPath()[0]` is not text entry (F types in a field), or
  the platform modifier + `Semicolon` anywhere. Both by physical `code`, so a Cyrillic layout works; key
  repeat and IME composition never start it.
- **While active** every key is swallowed. Label letters match by `code`; a complete label acts; Shift on
  the last letter only focuses; Backspace removes a letter; Escape or Mod+; exits (F is a label letter
  there). A trusted pointerdown or window blur also exits.
- `HINT_KEYS` is the one list: the handler compares against it and `shortcuts` displays it, so the
  cheatsheet rows and the matcher cannot drift. An app test asserts no chord collides with the keybinding
  table and that plain F is bound nowhere else.

## Labels

`hintLabels(n)` is Vimium's breadth-first generator over the home-row alphabet `asdfjklghqwertyuiop`:
prefix-free, shortest first, assigned in collection order. The typed prefix dims and labels that no longer
match hide. Labels wear the primary button pair (`control-primary-bg` / `-text`, the typed part
`control-primary-disabled-text`): the mockup's yellow has no token with a contrast-tested label colour,
and the primary pair is held to AA in every theme. The overlay is portalled to `<body>` at `z-200`,
`pointer-events-none`, labels `aria-hidden`; a `role="status"` bar names the keys. Positions are CSS
custom properties written from a ref (the pattern `PreviewCommenting` uses), offset 4/6 px above-left of
the target and clamped inside the window, and are re-measured on scroll (capture) and resize. Layout that
moves without scrolling (an entrance animation in flight) is not tracked.

## Targets (`targets.ts`)

Collected once per activation from `activeLayer()`, so an open dialog or menu scopes the labels:

- **Candidates:** `a[href]`, `button`, non-hidden `input`, `select`, `textarea`, `summary`, contenteditable,
  `tabindex >= 0`, interactive roles (button, tab, treeitem, option, menuitem*, switch, checkbox, radio,
  link, combobox, listbox, slider) — roving items whatever their tabindex — ARIA feed articles (the chat
  transcript), and `.monaco-editor` / `.xterm` roots. Open shadow roots are searched (Pierre diffs);
  iframes are not entered.
- **Skipped:** an `inert` element or ancestor (shadow hosts included); `checkVisibility` false (display,
  visibility, opacity 0) where the engine has it; a native `disabled` control; anything inside a Monaco or
  xterm root; a box that is empty after clipping by every `overflow` ancestor and the viewport; and, inside
  a `role="tree"`, `aria-hidden` + `tabindex=-1` pointer duplicates (chevrons, kebabs — the row's keys and
  menu reach them). `aria-hidden` alone is not a filter: Radix hides the page behind a modal that way,
  and the layer scope already handles it.
- **Anchors:** a zero-size `data-review-surface` (the review cursor proxy) is labelled at its parent.

## Activation (`press.ts`)

- **Press** = `pointerdown` → focus (unless the pointerdown was cancelled, as a real one would suppress
  the mouse default) → `pointerup` → `click`, with mouse coordinates at the box centre. Radix menus open on
  pointerdown, so a plain `click()` would miss them; dnd-kit's distance-activated sensors ignore a press
  that does not move. Pressed: buttons, links, `summary`, button-like inputs and the interactive roles.
- **Focus only:** text entry, listbox/slider, the review proxy, plain `tabindex` stops and feed articles;
  Monaco/xterm focus their first `textarea`. Shift makes any target focus only.

## Verification

Unit: label generation, key matching (Cyrillic layout, IME, repeat, platform modifier), letter typing, and
the target filter on a small fake DOM (visibility, inert, clipping, widgets, shadow roots, tree duplicates,
the review proxy, re-measuring). E2E `hint-mode.spec.ts` ([[module-browser-e2e]]).
