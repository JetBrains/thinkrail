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
lazy chunks independent and preserves the shadcn convention. `./utils` exposes `cn`; `./theme` exposes
only `onThemeSwap`, a DOM MutationObserver subscription to the completed `data-theme` signal, with
explicit cleanup. It knows nothing about the theme catalog or preferences.

Workspace imports may reach `contracts` and `@thinkrail/locales/react` (the shared i18next instance, for
primitive-owned strings such as the dialog's screen-reader Close and the toast's Dismiss label) only. External dependencies are React, Radix, cmdk,
react-resizable-panels, Remix Icon, class-variance-authority, clsx and tailwind-merge. Host internals,
pi, app stores, transport and theme runtime are forbidden. Tokens remain global CSS variables generated
under `apps/web/src/styles`; utilities follow [[web-color]], [[web-spacing]] and [[web-typography]].
The app's Tailwind sources and adoption guards include this package and extension web halves.

## Button system

`button` is the one implementation of an action button: `Button` (text, optional `iconLeft` /
`iconRight`), `IconButton` (icon only — `label` is required and becomes both the `aria-label` and the shared
`IconTooltip`), and `buttonVariants` for a non-button element that must look like one (a link). Neither
component accepts a native `title`: an explanation is `tooltip` (on `IconButton` it overrides the label's
tooltip text), rendered through the same `IconTooltip`, so it also shows on a disabled button — the
place a reason for being unavailable matters most. A caller that passes `disabled` at all (even `false`)
gets the `wrapTrigger` span automatically, so the tooltip survives the disabled button's
`pointer-events: none` and the DOM shape never changes when `disabled` toggles; an explicit `wrapTrigger`
still isolates a second Radix trigger, and `wrapTrigger={false}` opts out. Every
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
  `l` 32 / 12 / 20 / 6 / 32 (the default). At `s` the gap equals the side padding: a 12px icon read as
  lighter than the 14px label beside it, so the icon was raised to 14px and the gap to 4px to keep the pair
  legible. Icon weight follows the icon size only — Remix Icon ships Line/Fill, not stroke weights, so
  there is no per-size weight to match and none is simulated with CSS. Icons never shrink; text buttons
  size to content unless the layout asks for `w-full`.
- **States** live in the component, not at the call site: hover uses the variant's hover role
  (soft-primary: `control-soft-primary-bg-hovered` plus a `primary-muted` border, so its accent label
  stays AA); pressed (`:active`, pointer down or Space held) looks exactly like hover — the same `active:` classes mirror the `hover:` ones, so a keyboard press without a pointer shows it too — and never moves geometry; focus-visible is a 2px `primary` outline with a 2px offset in every variant, so
  it stays visible over a primary or destructive fill and on every surface (`ghost`, which has no surface
  of its own, also takes its hover fill and default text while focused, so the focused button reads as a
  control and not only as a ring around empty space); disabled keeps the element in
  place on the `control-disabled-*` / `control-primary-disabled-*` / `control-destructive-disabled-*` roles
  (never opacity, never hidden); `loading` swaps the icon (with `spinIcon`, it instead rotates the button's own icon in place — the refresh idiom of `apps/web/src/components` *Loading vocabulary*) (or, with no icon, overlays the label it keeps
  transparent for width and the accessible name) for a spinner at the size's icon size, sets `aria-busy`, and natively disables the
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
  rows, change rows, todo rows, history-overlay rows and every cmdk `CommandItem`.
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
`popover`, `command` (cmdk combobox body), `textarea`, `tooltip`, `resizable`, `toast`, `toggle-segment`
(the slim header toggle: active segment on `control-bg-selected` + `text-default`, `data-active` /
`aria-pressed`), `skeleton` (`SkeletonRows` / `LoadingRegion`, the one loading placeholder; its usage rules
live in the web components spec), and `attention-line` (`AttentionLine`, the "Your input is needed · Agent is
waiting" line; `announced` hides the visible line from assistive tech once the always-mounted polite
region carries the announcement, `live={false}` drops the region), alongside `utils` and `theme`.
`menu-styles` is shared by the menu primitives and custom app menu rows. `toggle-segment` and `skeleton`
moved here from the app when the resource renderers became a package, because both the app and
[[module-resource-renderers]] use them; `attention-line` moved for the same reason when the
`ask_user_question` card became an extension web half, because the app's extension prompts use it too.

- Switch exposes native disabled behavior and `role="switch"`/`aria-checked`, not visible On/Off
  text. Every modal dialog's overlay carries `data-modal-layer`, and `useModalLayerOpen()` reports whether one is open: it lets callers tell "covered by a modal" from their own visibility without a dialog registry, independent of how `aria-hidden` treats live regions. Dialog accepts `hideClose` for chromeless surfaces. `DialogPanel` renders Radix content in place
  without a portal or overlay for caller-positioned, non-modal dialogs; title/role semantics, Escape
  dismissal, and focus return remain Radix-owned while surrounding UI stays interactive.
- React 19 refs pass through controls; dialog/popover portals preserve accessible focus and scroll
  behavior. Popover accepts a host Dialog container for scroll-lock compatibility.
- Icon-only controls use `IconTooltip` with `aria-label`, not native `title`; one root `TooltipProvider`
  sets the delay. Native `title` remains only for non-control truncation fallbacks or surfaces outside
  the provider (the app's review widgets). `wrapTrigger` supplies the interactive flex span for a disabled
  control or another Radix trigger, isolating their `data-state` values; callers do not hand-roll that
  wrapper, and `Button`/`IconButton` apply it themselves whenever the caller passes `disabled`. App, SDK,
  and extension web call-site tests enforce the no-hand-rolled-span convention. `IconTooltip` opens on
  hover and on *keyboard-visible* focus only: focus that does not match `:focus-visible` (a dialog's or
  popover's autofocus after a pointer open, focus returning to a clicked trigger) never opens it, because
  an open tooltip is the topmost dismissable layer and would swallow the Escape meant for the dialog. For
  the same reason an open `IconTooltip` closes itself synchronously on Escape in a window capture
  listener, before Radix's document-level layer handling, so one Escape dismisses the tooltip *and* the
  dialog, popover or menu beneath it.
- Context and dropdown menus share menu geometry and token classes: content surface, radius/shadow,
  item/icon spacing, separators, semantic action colors, focus rows, and viewport collision behavior.
  Context menus add pointer-position right-click/touch long-press anchoring; features own enabled gestures
  and actions. Dropdowns are vertically bounded by the smaller of 60vh and Radix's available height,
  scrollable with horizontal overflow hidden so long rows truncate rather than scroll.
- Toast exposes `ToastProvider`/`Toast`/`ToastViewport`/`ToastTitle`/`ToastDescription`/`ToastAction`/
  `ToastClose` and `toastVariants` (`error`/`success`/`warning`/`info`). Severity is a uniform semantic
  border (`border-feedback-*-muted`) on a neutral `bg-container-elevated-bg` background. `ToastAction` is
  unstyled: the caller supplies the control through `asChild`. Queue ownership, icons, and notification
  lifetimes stay in the app (`panels/Toaster` composes the primitives).
- Resizable handles paint a 1 px line at their leading edge; the pointer hit area extends only into the
  following panel (fine-pointer margin 1 px), so the preceding panel's trailing-edge scrollbar stays
  usable. There is no grip variant.
- Primitives use only the host's token utilities, never shadcn's default oklch palette.

Code highlighting is deliberately absent: `CodeBlock` and shiki depend on the app's theme registration
and remain app-local until a second extension requires that seam.
