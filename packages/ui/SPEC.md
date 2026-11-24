---
id: module-ui
type: module-design
status: draft
title: Shared host UI primitives
parent: architecture
depends-on: [module-contracts, module-locales]
references: [web-color, web-spacing, web-typography]
---

## Responsibility

The owned shadcn/Radix primitives shared by the app and extension web halves. Presentational only:
feature state, theme selection, and token generation stay with the app.

## Boundary

Primitives expose per-file `@thinkrail/ui/<primitive>` subpaths, not a root component barrel; this keeps
lazy chunks independent and preserves the shadcn convention. `./utils` exposes `cn`; `./keyboard` exposes
`isImeComposing`, `yieldEscapeToIme`, the platform modifier (`isApplePlatform`, `hasPlatformModifier`:
Cmd on Apple, Ctrl elsewhere — shared so the app's shortcuts and an extension's card read one definition)
and the pure chord primitives: `chordPressed(chord, event, platform, { ignoreShift })` (physical `code`
or typed key, exact modifiers, `Mod` = ⌘ on Apple and Ctrl elsewhere, no Alt chord under AltGraph off
Apple — the app's keybinding matcher delegates to it, so the two cannot drift), `chordCaps`, `keyCap`,
`codeLabel` (a code's US label), `ariaKeyShortcuts(chords, platform)` (one platform's modifier names, never
Meta and Control both; the numpad Enter reads `Enter`, so a pair announces once), `isTypingChord`, `ARROW_TWIN_COMMANDS` (`arrows.left/down/up/right`, H/J/K/L
by `code`, in shared scope `ARROW_TWINS_SCOPE`) and `twinArrow(id)` (the arrow a matched twin stands for). `./reading` is the
one definition of reading keys, shared by the chat transcript and the resource renderers' reading
surfaces: `READING_COMMANDS` (`reading.top` G and `reading.bottom` Shift+G by `code`, shared scope
`READING_SCOPE`), `readingCommand(event, keys, local?)` (a line, a page, an end or a step sideways from
the arrows and their twins, Space/Shift+Space, PgUp/PgDn, Home/End and g/G; modified, shifted and composing
presses pass), `READING_LINE` (40 px) and `readingPage` (the viewport less a line), the pure
scroll-before-step geometry — `scrollBeforeStep` (scroll a line, clamped to the item's far edge, until
that edge shows; then 0 and the cursor steps) and `stepRevealDelta` (the least scroll showing a stepped-to
item: all of it when it fits, else its near edge plus a line) over `ReadingSpan`s, `spansOverlap`,
`ownReadingSpan(stop, next)` (a stop's own extent: its box, ended where the next stop begins when that
stop is nested inside it, so a parent never counts its children's height) — and
`readingScrollTarget` / `scrollReading` for a plain scroller. `./local-keys` is the seam an element matches its
rebindable local keys through, whoever renders it (the app, resource renderers, an extension card):
`useLocalKeys(scope, defaults)` returns `{ match(event, { ignoreShift, textEntry }), caps(id), label(id),
aria(...ids) }` (`label` joins the caps the platform's way, `""` when unbound; `aria` lists every chord of
the ids for `aria-keyshortcuts`) over the
effective chords `LocalKeymapProvider` supplies (the app's resolved table), or over `defaults` when no
provider is mounted or it lacks the scope — the `./fonts` pattern of a host-published signal with a
standalone default. `match` returns the first exact match; `ignoreShift` only adds a fallback after it —
a shifted press may match a chord that does not require Shift — so a binding that requires Shift keeps
it and never shadows the exact match of its unshifted twin (`chordPressed`'s `ignoreShift` relaxes Shift
the same one way). `match` ignores an IME composition and a typing chord in text entry (the provider's
`isTextEntry`, else inputs and contenteditable — `textEntry` overrides that verdict for a caller that
knows a press edits nothing, as the history search's `Delete` at the end of its query); `defaults` must be a stable module constant. `./focus` exposes
the one tabbable-control selector (`TABBABLE_SELECTOR`, which includes a `<details>` element's own
`<summary>`, natively tabbable), `focusFirstControl(container)` (the first
control, focused with `preventScroll`), shared by the app's focus recovery and reveal moves and the
resource renderers' reveal of a comment card, the one default-focus rule — `canFocus` (connected,
rendered, not inert or disabled, tabbable or carrying a `tabindex`), `focusTarget` (the element, else its
first such control) and `defaultFocusTarget(container)` (the innermost `FOCUS_DEFAULT_SELECTOR`
marker's target, then an outer one's), which the shell's region landings and a keyboard open's tab
content share — and `focusAndReveal(element)` — focus with `preventScroll`,
then scroll only the nearest vertically scrolling ancestor just enough (`revealDelta`, the outline
included) to show it, never `scrollIntoView`'s every ancestor — which the ask card, the chat and the
shell's Esc landing use for a waiting question's controls (`scrollsVertically` is its scroller test) —
and its horizontal companion `revealHorizontally(element)` (no focus; the nearest ancestor that
`scrollsHorizontally`, same `revealDelta` along the x axis), which keeps the ask card's selected question tab
in view inside its strip; `./theme` exposes
`onThemeSwap`, a DOM MutationObserver subscription to the completed `data-theme` signal, with
explicit cleanup, and `cssColorToHex` (a computed colour — `rgb()`, `rgba()`, `color(srgb …)` or a
named colour — canonicalized to hex, `""` when unparseable), which strict consumers such as Monaco, xterm
and extension canvases take instead of a token's raw `color-mix()`. It knows nothing about the theme
catalog or preferences. `./fonts` is the same seam for
the font settings: `onFontsChange` / `fontsRevision` over the `data-fonts` signal, `resolveFont(className)`
(the computed family, size, weight and ligatures of a generated typography class, for surfaces that take
fonts as JS options), `fontsLoaded` (resolves once the faces for that family, size and weight have
loaded), and `watchFont(className, fields, onChange)` — how such a surface follows the class: the latest
change wins once its faces load, a change to none of the listed fields is skipped, and a new face set (the
`data-font-faces` signal) re-applies an unchanged font. It knows nothing about the settings or the runtime
that publishes them.

Workspace imports may reach `contracts` (types — `project-tree` reads `Workspace["kind"]`) and `@thinkrail/locales/react` (the shared i18next instance, for
primitive-owned strings such as the dialog's screen-reader Close and the toast's Dismiss label) only. External dependencies are React, Radix, cmdk,
react-resizable-panels, Remix Icon, class-variance-authority, clsx and tailwind-merge. Host internals,
pi, app stores, transport and theme runtime are forbidden. Tokens remain global CSS variables generated
by `@thinkrail/design-tokens`, imported by each host stylesheet; utilities follow [[web-color]], [[web-spacing]] and [[web-typography]].
The app's Tailwind sources and adoption guards include this package and extension web halves.

## Custom glyphs

`custom-icon` (`CustomIcon`, `CustomIconName`) renders a project glyph Remix lacks from `icons/*.svg` as a
`currentColor` CSS `mask-image` span, so it sizes with `size-*` and colours with `text-*` exactly like a Remix
icon; its classes live in `custom-icon.css`, which every host stylesheet imports (the SVGs resolve relative to
it, so the bundler ships them). Today: `file-diff-line` / `file-diff-fill` (the Changes review glyph).

## Project tree

`project-tree` is the visual identity of the project tree's rows, shared by the IDE's `panels/ProjectTree`
and the phone shell: `ProjectGlyph` (folder, Fill when selected, or the running badge), `WorkspaceGlyph` (home
for Default, open folder for an external folder, branch for a worktree; Fill when active; the running badge
while working), `WorkspaceLabel` (name, with `WorkspaceBranch` as the second line when the branch differs)
keeping the `workspace-name` / `workspace-branch` test ids. Row geometry, menus, rename and actions stay
with the host: the IDE's 22px panel rows, the phone's 44px touch rows.

## Status marks

The two store-free session status marks the IDE and the phone shell share. `./brand-mark` exports the
"TR" monogram geometry (`BRAND_MARK_SEGMENTS`, `BRAND_MARK_PATH`) they and the web logo draw from.

- **`attention-dot`** (`AttentionDot`) — the store-free, static green/accent dot whose sole accessible label is “Needs
  attention.” It carries no reason, count, tooltip, motion, or clearing behavior; callers decide only whether
  it is present. It is the one marker for both needs-input and unread-result attention.
- **`running-icon`** (`RunningIcon`) — the store-free **“ThinkRail is working” badge**: the brand monogram inside a
  rounded-square frame, drawn in `currentColor` so it sizes with `size-*` and colours with `text-*` like a
  Remix icon, with the accessible label “Agent working”. While motion is allowed, the frame (two halves
  leaving a gap on the left and meeting on the right) and the six letter strokes of the monogram draw and
  erase on one 3.263s cycle (`loader-*` keyframes in `@thinkrail/design-tokens/styles/motion.css`, so every host stylesheet that imports the tokens animates it); a beat with only the frame showing is
  part of the design. Each letter stroke is a wide line clipped to its region of `BRAND_MARK_SEGMENTS` (`./brand-mark`), the
  same segments `BRAND_MARK_PATH` — the web shell's logo — is joined from, so the fully drawn badge is the shell's mark rather than a
  second copy that could drift. Only the stroke centre-lines, the frame, and the small gap between the R's
  stem and top bar (the stem stroke stops short) are local animation geometry. Reduced motion leaves every
  stroke at its fully drawn dash: the static, complete badge. This loader replaced a ring with a lapping
  train and a pulsing monogram; before that the row's own identity glyph breathed, dropped because a
  dimming folder reads as “disabled” at 14px. Callers pass only size/colour classes and decide from
  normalized host state whether a top-level session is running; the icon renders no dot, spinner, count,
  tooltip, or idle state.

## Button system

`button` is the one implementation of an action button: `Button` (text, optional `iconLeft` /
`iconRight`), `IconButton` (icon only — `label` is required and becomes both the `aria-label` and the shared
`IconTooltip`), and `buttonVariants` for a non-button element that must look like one (a link) — it
returns the same merged class list the components render, compounds resolved — with
`buttonDataAttributes` giving such an element the same `data-slot` / `data-variant` / `data-size` /
`data-icon-only` / `data-selected` contract the components render (the panel tool rails, the Monaco
comment widget), and `withIconClass(Icon, classes)` for a tinted or animated glyph (a success check, a
working pulse) — created once at module scope, never during render, so the icon keeps its identity. Neither
component accepts a native `title`: an explanation is `tooltip` (on `IconButton` it overrides the label's
tooltip text), rendered through the same `IconTooltip`, so it also shows on a disabled button — the
place a reason for being unavailable matters most. While `disabled`, a button moves its tooltip trigger to
the `wrapTrigger` span automatically, so the tooltip survives the disabled button's `pointer-events:
none`; the value, not the prop's presence, decides, because a Radix trigger such as
`DropdownMenuTrigger asChild` injects `disabled={false}` into every child and a wrapper would take a
text button's `min-w-0` truncation away. The button element remounts inside the span when `disabled`
flips; an explicit `wrapTrigger` keeps the span permanently (and isolates a second Radix trigger), and
`wrapTrigger={false}` opts out. Every
ordinary action in the app, the renderer package and extension web halves renders through it; a raw
`<button>` carrying a button skin is rejected by `apps/web/src/styles/buttonUsage.test.ts` unless that
test's documented specialized list names it.

- **Variants** (exactly five): `primary` (accent fill — the main action of a surface), `soft-primary`
  (accent tint + accent text; also every former transparent "green ghost"), `outline` (neutral bordered),
  `ghost` (no surface, muted text, neutral hover fill — the default for `IconButton`), `destructive` (danger
  fill; confirms irreversible actions). A call site picks the variant that matches the action's existing
  look; there is no `soft-default` and no colour override at a call site. `tone` (`warning` | `danger`)
  is the one sanctioned label colour: on `ghost` and `outline` it keeps the feedback colour in every state
  (rest, hover, focus-visible, pressed, selected — disabled still wins), because a colour set at the call
  site loses to ghost's own state text in focus and pressed, exactly when the control is used.
- **Sizes** (exactly three; border-box, same for every variant and state, radius `rounded-sm`, type
  `tr-text-button` — the 14px interface face at weight 470, one step above ordinary UI text): `s` 20px
  high, 4px text padding, 14px icon, 4px icon↔text gap, 20px square icon-only; `m` 24 / 8 / 16 / 4 / 24;
  `l` 32 / 12 / 20 / 6 / 32 (the default for `Button`; `IconButton` defaults to `m`). At `s` the gap equals the side padding: a 12px icon read as
  lighter than the 14px label beside it, so the icon was raised to 14px and the gap to 4px to keep the pair
  legible. Icon weight follows the icon size only — Remix Icon ships Line/Fill, not stroke weights, so
  there is no per-size weight to match and none is simulated with CSS. Icons never shrink; text buttons
  size to content unless the layout asks for `w-full`.
- **States** live in the component, not at the call site: hover uses the variant's hover role
  (soft-primary: `control-soft-primary-bg-hovered` plus a `primary-muted` border, so its accent label
  stays AA); pressed (`:active`, pointer down or Space held) looks exactly like hover — the same `active:` classes mirror the `hover:` ones, so a keyboard press without a pointer shows it too — and never moves geometry; focus-visible is the shared `focus-ring` (1px `focus-ring` outline, 1px outside) in every variant, so
  it stays visible over a primary or destructive fill and on every surface (`ghost`, which has no surface
  of its own, also takes its hover fill and default text while focused, so the focused button reads as a
  control and not only as a ring around empty space) — except a `ghost` icon-only button, which takes
  `focus-ring-inset`, because those sit flush in 28px header strips and rails whose
  `overflow: hidden` would clip an outer ring; disabled keeps the element in
  place on the `control-disabled-*` / `control-primary-disabled-*` / `control-destructive-disabled-*` roles
  (never opacity, never hidden) through the `button-disabled` variant the app stylesheet defines — a
  `data-disabled` element, or a natively `:disabled` one that is not loading, so a button inside a disabled
  `<fieldset>` takes the skin too; `loading` swaps the icon (with `spinIcon`, it instead rotates the button's own icon in place — the refresh idiom of `apps/web/src/components` *Loading vocabulary* — and under reduced motion shows the static spinner glyph instead, so the state stays visible) (or, with no icon, overlays the label it keeps
  transparent for width and the accessible name) for a spinner at the size's icon size, sets `aria-busy` (a caller's own `aria-busy` survives on a button that is not loading — the busy-but-clickable mic), and natively disables the
  element so the action cannot run twice; `selected` — or an open Radix trigger (`data-state="open"`) — is
  the persistent toggle/open fill (`control-bg-selected`) for `outline` and `ghost`, distinct from pressed;
  `soft-primary` shows selected as its hover look (`primary-muted` border on the hover tint), the one
  accent step that keeps its label AA, so an expanded accent chip still reads as expanded. Toggles keep
  `aria-pressed`; disclosures keep `aria-expanded`.
- **Rows**: a list row that paints its own hover or selected fill uses the same roles as ghost's fills
  (`control-bg-hovered` / `control-bg-selected`), so a ghost action on it would show no feedback. Such a
  row carries `data-row`, and a `ghost` button inside it takes `container-elevated-bg` for hover, pressed,
  focus-visible and selected instead — the raised look row actions had before the system — so a hovered
  row action and an open row menu stay visible against the filled row. Marked rows: project and workspace
  rows, change rows, todo rows, every cmdk `CommandItem`, and a history-overlay row only while it is
  selected — those rows sit on the overlay's elevated surface and fill only when selected, so an unselected
  row keeps ghost's own hover fill.
- **Call sites own placement only**: margins, self/flex/grid placement, `w-full`, positioning, responsive
  visibility and whole-button hover reveal. Height, padding, gap, radius, colours, borders, typography and
  state skins are rejected by the adoption guard. Documented exceptions live in that guard with a reason
  (red-on-hover raw actions that `tone` does not express; extension select options that must wrap long
  labels).
- **Not buttons**: tabs, menu items, switches, toggle segments, radio/segmented options, tree and list rows,
  disclosure headers, chips, inline text links, the composer send pill, native window controls and large
  choice cards keep their own primitives or components.
- The dialog close button and `ToastClose` are `IconButton ghost m`.

## Primitive invariants

The per-file surface is `button`, `switch`, `dialog`, `dropdown-menu`, `context-menu`, `menu-styles`,
`popover`, `command` (cmdk combobox body), `textarea`, `tooltip`, `resizable`, `toast`, `tree-row`,
`tree-item`, `diff-stat-badge`, `folder-chains`, `toggle-segment`
(the slim header toggle: active segment on `control-bg-selected` + `text-default`, `data-active` /
`aria-pressed`, and an explicit `tabIndex={0}` because the macOS WKWebView skips a `<button>` without one
on Tab), `skeleton` (`SkeletonRows` / `LoadingRegion`, the one loading placeholder; its usage rules
live in the web components spec), and `attention-line` (`AttentionLine`, the "Your input is needed · Agent is
waiting" line; `announced` hides the visible line from assistive tech once the always-mounted polite
region carries the announcement, `announcement` replaces its default text, `live={false}` drops the region), and `keycaps` (`Keycaps`, a row of
`<kbd>` caps for already-formatted key labels, a repeated key such as double Shift included), alongside `utils`, `keyboard`, `local-keys`, `theme` and `fonts`.
`menu-styles` is shared by the menu primitives and custom app menu rows. `toggle-segment` and `skeleton`
moved here from the app when the resource renderers became a package, because both the app and
[[module-resource-renderers]] use them; `attention-line` moved for the same reason when the
`ask_user_question` card became an extension web half, because the app's extension prompts use it too.
`tree-row` (`TreeRow`, the file-style tree row: chevron or spacer, folder or file icon — or the caller's
`icon` —, truncated label, trailing slot, `data-path`; a `treeitem` at its `level` in tree `treeId`, with
`aria-expanded` on folders, `aria-current` on the active row, a folder its own toggle and a file opened kept),
`diff-stat-badge` (`DiffStatBadge`, the `+N −M` line counts) and `folder-chains` (`startFolderChain` /
`extendFolderChain` / `resolveFolderChain`, pure: a run of single-directory children shown as one
slash-joined row) moved here from `apps/web/src/panels` with the session-insights heat tree, their second
consumer; the app's Files, Changes, Plan and Artifacts trees keep using them and `ChangesTree` itself stays
app-local (it reaches the store). `tree-item` is the item half of the app's keyboard tree model
(`useTreeItem(id, { level, label, expanded?, selected?, toggles?, openKept? })`: the `treeitem` role,
`aria-*` and `data-tree-*` attributes, and the roving tab stop and search mark read from
`TreeItemScopeContext`); it moved with `TreeRow`, which renders one. The container — keys, search field,
the cursor and marks it provides — stays the app's `Tree` (`apps/web/src/panels/treeNavigation.tsx`), so
outside one an item is natively tabbable and unmarked, as in an extension's tree.

- Switch exposes native disabled behavior and `role="switch"`/`aria-checked`, not visible On/Off
  text. Every modal dialog's overlay carries `data-modal-layer`, and `useModalLayerOpen()` reports whether one is open: it lets callers tell "covered by a modal" from their own visibility without a dialog registry, independent of how `aria-hidden` treats live regions. Dialog accepts `hideClose` for chromeless surfaces. `DialogContent` contains what it holds: width and max height keep a window gutter, the body scrolls by default, long text wraps, and `DialogFooter` wraps its actions and then their labels (a footer `Button` grows past its fixed height only then). A caller adding a pinned footer scrolls an inner `min-h-0 flex-1` body; one portalling popovers into the content element sets `overflow-visible` and scrolls an inner body. An inner scroll body is `relative`: otherwise an absolutely positioned descendant (an `sr-only` label) takes the dialog as its containing block and stretches the dialog's own scroll area, giving it a second scrollbar. Flex rows of data still need `min-w-0`. `DialogPanel` renders Radix content in place
  without a portal or overlay for caller-positioned, non-modal dialogs; title/role semantics, Escape
  dismissal, and focus return remain Radix-owned while surrounding UI stays interactive.
- **An active IME owns the key** ([[module-web]]'s text-field rule). `isImeComposing` is `isComposing`
  or the legacy `keyCode` 229 sentinel, the same test cmdk applies. The sentinel is needed because
  `compositionend` may come before the final keydown, leaving `isComposing` false while the IME still
  owns that event. `DialogContent`, `DialogPanel` and `PopoverContent` wrap the caller's
  `onEscapeKeyDown` in `yieldEscapeToIme`. A composing Escape is `preventDefault`ed, so Radix's
  document-level Escape listener keeps the layer open, and the caller's handler never sees it. Menus hold
  no text fields and stay unwrapped. `keyboard.test.ts` scans the app, ui, `resource-renderers` and
  extension web sources: a file with both a key handler and a text field must use the guard. The scan is
  file-level, and each allow-list entry carries its reason.
- React 19 refs pass through controls; dialog/popover portals preserve accessible focus and scroll
  behavior. Popover accepts a host Dialog container for scroll-lock compatibility.
- Icon-only controls use `IconTooltip` with `aria-label`, not native `title`; one root `TooltipProvider`
  sets the delay. Native `title` remains only for non-control truncation fallbacks or surfaces outside
  the provider (the app's review widgets). `wrapTrigger` supplies the interactive flex span for a disabled
  control or another Radix trigger, isolating their `data-state` values; callers do not hand-roll that
  wrapper, and `Button`/`IconButton` apply it themselves while disabled. App, SDK,
  and extension web call-site tests enforce the no-hand-rolled-span convention. `IconTooltip` opens on
  hover and on *keyboard-visible* focus only: focus that does not match `:focus-visible` (a dialog's or
  popover's autofocus after a pointer open, focus returning to a clicked trigger) never opens it, because
  an open tooltip is the topmost dismissable layer and would swallow the Escape meant for the dialog. For
  the same reason an open `IconTooltip` closes itself synchronously on Escape in a window capture
  listener, before Radix's document-level layer handling, so one Escape dismisses the tooltip *and* the
  dialog, popover or menu beneath it. An optional `shortcut` (pre-formatted caps — the tooltip never
  formats a chord, the app passes its own labels) renders as `Keycaps` after the label; `Button` and
  `IconButton` forward it as `tooltipShortcut`. `passThrough` makes a tooltip that never takes the pointer
  (a tooltip over dense row targets, where it would cover the next row's click targets): it closes as the
  pointer leaves the trigger (`disableHoverableContent`) and the content carries `data-pass-through` and
  `pointer-events-none`; the app's `global.css` gives Radix's positioning wrapper around such content
  `pointer-events: none` with one `:has()` rule, since a class on the content cannot reach its parent. Tooltip content stacks at `z-150`, above dialogs and the toast
  viewport (`z-[100]`), so a toast's own close tooltip is never painted under the toast.
- Context and dropdown menus share menu geometry and token classes: content surface, radius/shadow,
  item/icon spacing, separators, semantic action colors, focus rows, and viewport collision behavior.
  Context menus add pointer-position right-click/touch long-press anchoring; features own enabled gestures
  and actions — a trigger opts into the keyboard gesture (Context Menu key or Shift+F10, anchored below the
  trigger) by passing `openContextMenuFromKeyboard` as its `onKeyDown`. `isContextMenuKey` is that
  gesture's one predicate: a row whose menu is a controlled dropdown opens it on the same keys. Each opener
  is explicit because macOS WebKit synthesizes no `contextmenu` event from Shift+F10. Dropdowns are vertically bounded by
  the smaller of 60vh and Radix's available height, scrollable with horizontal overflow hidden so long rows
  truncate rather than scroll.
- Toast exposes `ToastProvider`/`Toast`/`ToastViewport`/`ToastTitle`/`ToastDescription`/`ToastAction`/
  `ToastClose` and `toastVariants` (`error`/`success`/`warning`/`info`). Severity is a uniform semantic
  border (`border-feedback-*-muted`) on a neutral `bg-container-elevated-bg` background. `ToastAction` is
  unstyled: the caller supplies the control through `asChild`. Queue ownership, icons, and notification
  lifetimes stay in the app (`panels/Toaster` composes the primitives).
- `DialogContent` and `DialogPanel` stay open for a press that began in the toast viewport (the viewport
  records its `pointerdown`s; `isToastPress` reads them) and for focus landing in the viewport, so a toast's
  action or close works over a dialog. Radix would do this through its
  dismissable-layer branch, but the dialog and the toast resolve different copies of that module; the
  dialog's copy also defers an outside press to its `click`, by when a closed toast is already detached,
  so the record is per event, not per element. Unifying the copies is not the fix: Radix then makes each
  toast the topmost layer, and the first Escape would close an error toast instead of the dialog.
- Resizable handles paint a 1 px line at their leading edge; the pointer hit area extends only into the
  following panel (fine-pointer margin 1 px), so the preceding panel's trailing-edge scrollbar stays
  usable. There is no grip variant.
- Primitives use only the host's token utilities, never shadcn's default oklch palette.

Code highlighting is deliberately absent: `CodeBlock` and its highlighter depend on the app's theme registration
and remain app-local until a second extension requires that seam.
