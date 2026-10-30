Icons are [Remix Icon](https://remixicon.com) glyphs from `@remixicon/react`, plus a few project-custom
glyphs. They are sized by UI *context*, not location, and their style follows state.

## Style: Line by default, Fill when active

- **The `Line` (outline) variant is the default; the `Fill` (solid) variant marks the *active/selected*
  item** — the selected project and active workspace rows (`ProjectTree`), the active/main-spec node
  (`SpecsPanel`), the active file/dir row (`TreeRow`), the active editor tab and the open panel in a tool
  rail swap to `Ri…Fill`; everything else (buttons, chevrons, status, composer, chat, menus) stays
  `Ri…Line`.
- Icons with no Line/Fill pair (`RiParagraph` / `RiDraggable` / `RiLinkM` / `RiListCheck3`) render their
  single style in both states.
- Remix glyphs are `fill="currentColor"`, so the semantic `text-*` utilities colour them.

:::live icon-styles

## Size by context

Icons are imported by name — no `<Icon>` wrapper and no `size=` prop, and never a container added just to
resize a glyph — and sized on the Tailwind `size-*` scale by context, in three tiers:

| Class | Context |
| --- | --- |
| `size-12` | **Chat-content** indicators — tool activity, plan/todo status, expand/collapse chat details; subordinate to chat text |
| `size-14` | **Compact interface / navigation chrome** — left and right panels, panel and toolbar headers, tabs, the mobile switcher rail, menu items |
| `size-16` | **Every disclosure/expand chevron**, in every context |

:::live icon-tiers

- **Every disclosure/expand chevron** (`ChevronDown/Right/Left/Up`) is `size-16` in every context,
  regardless of tier — except a chevron inside a button.
- **Icons inside buttons are not tiered by context.** `Button` / `IconButton` size their icon, chevrons
  included, from the button size, and the call site passes the icon component, never a `size-*` class
  (see [Button](#/button)).
- Menu-item icons are centralized once in `packages/ui/menu-styles.ts` (`menuItemClass`).

## Alignment

- The **icon↔text gap is `gap-4`** across all icon+label rows (nav rows, menu/command items, tabs).
- A **two-line** row (e.g. a workspace whose branch differs from its name) **top-aligns** the icon to the
  first line (`items-start` + `mt-2`) so the glyph hangs on its title, while a single-line row stays
  vertically centred (`items-center`, no nudge).

## Project-custom glyphs

Glyphs that Remix lacks live as SVGs in `apps/web/public/custom-icons/` and render through the
`CustomIcon` primitive (`apps/web/src/components/CustomIcon`) — a `currentColor` CSS `mask-image` span, so
they theme and swap Line/Fill by state exactly like Remix glyphs. The **Changes** tool uses the custom
`file-diff` glyph; **Review** uses `RiDiscussLine` / `RiDiscussFill`.

:::live custom-icons
