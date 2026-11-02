import type {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import type { ComponentProps } from "react";
import { type PartDocs, partProps } from "../parts";
import type { ComponentDoc } from "../types";

const rootProps = {
	open: {
		type: "boolean",
		description:
			"Controlled open state. Control it when the menu loads data on open, opens from a second trigger (right-click on a row) or keeps a row highlighted while open.",
	},
	onOpenChange: {
		type: "(open: boolean) => void",
		description: "Called on every open and close; pair with `open`.",
	},
	modal: {
		type: "boolean",
		default: "true",
		description:
			"While open, outside pointer events and page scroll are blocked and focus stays in the menu. No ThinkRail call site changes it.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenu>>;

const triggerProps = {
	asChild: {
		type: "boolean",
		description:
			"Merges the trigger onto its child. Use it with a Button or IconButton, which then shows its selected look while the menu is open.",
	},
	disabled: {
		type: "boolean",
		description:
			"Blocks opening. With `asChild` and a Button or IconButton child, set `disabled` on the child instead, as AppearanceSettings does; the child's own prop wins over the trigger's.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuTrigger>>;

const contentProps = {
	align: {
		type: '"start" | "center" | "end"',
		default: '"center"',
		description:
			"Alignment against the trigger. Call sites use `start` under a left-edge trigger and `end` for a trailing kebab or `+`.",
	},
	side: {
		type: '"top" | "right" | "bottom" | "left"',
		default: '"bottom"',
		description: "Preferred side; Radix flips it when the viewport is too small.",
	},
	sideOffset: {
		type: "number",
		default: "4",
		description:
			"Gap to the trigger. The ThinkRail wrapper sets it to 4; Radix's own default is 0.",
	},
	onCloseAutoFocus: {
		type: "(event: Event) => void",
		description:
			"Runs before focus returns to the trigger. Call `event.preventDefault()` when an item moved focus on purpose (an inline rename, a dialog).",
	},
	className: {
		type: "string",
		description:
			"Width bounds only — `max-w-[…]` for menus with long rows, `min-w-[var(--radix-dropdown-menu-trigger-width)]` to match a select-like trigger, a fixed `w-*`. The surface, padding and height bound come from the wrapper.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuContent>>;

const itemProps = {
	onSelect: {
		type: "(event: Event) => void",
		description:
			"The action. The menu closes afterwards unless the handler calls `event.preventDefault()`.",
	},
	disabled: {
		type: "boolean",
		default: "false",
		description:
			"Keeps the item visible but unfocusable and unselectable. Put the reason in the label.",
	},
	className: {
		type: "string",
		description:
			"Content layout only: `items-start` for two-line rows, `justify-between` for a trailing indicator.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuItem>>;

const labelProps = {
	className: {
		type: "string",
		description: "`truncate` for a long heading such as a workspace name; nothing else.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuLabel>>;

const radioGroupProps = {
	value: { type: "string", description: "The selected item's `value`." },
	onValueChange: {
		type: "(value: string) => void",
		description: "Called with the chosen item's `value`; narrow the string before storing it.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuRadioGroup>>;

const radioItemProps = {
	value: { type: "string", description: "Required. The value this option selects." },
	disabled: {
		type: "boolean",
		default: "false",
		description: "As on `DropdownMenuItem`.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuRadioItem>>;

const subTriggerProps = {
	children: {
		type: "ReactNode",
		description:
			"Icon and label of the submenu row. The wrapper appends the right chevron; do not add one.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuSubTrigger>>;

const subContentProps = {
	className: {
		type: "string",
		description:
			"Width bounds only. The submenu already has its own surface, bounded height and scrolling.",
	},
} satisfies PartDocs<ComponentProps<typeof DropdownMenuSubContent>>;

export const dropdownMenu = {
	slug: "dropdown-menu",
	name: "DropdownMenu",
	group: "Overlay",
	source: "packages/ui/dropdown-menu.tsx",
	preview: "actions",
	tag: "<DropdownMenuContent",
	importLine:
		'import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@thinkrail/ui/dropdown-menu";',
	summary:
		"A list of actions or options that opens from a trigger — a kebab, a `+`, a split-button chevron or a select-like button. It is Radix DropdownMenu with ThinkRail's menu surface, row, label and separator styling (shared with ContextMenu through `menu-styles`), a portal and a viewport-bounded, scrolling height. The call site provides the trigger, the rows' icons and labels, and the actions.",
	whenToUse: [
		"Overflow actions behind a kebab or `+` in a header or a row: Copy, Save .md, Open in, Rename, Reveal.",
		"Choosing one value from a short list behind a select-like Button (theme, MCP exposure, bottom panel alignment), with `DropdownMenuRadioGroup`.",
		"A secondary-actions chevron beside a primary action (the ship split button).",
		"A row whose actions also open on right-click: one controlled dropdown, two triggers.",
		"A grouped menu with headings and a nested level (`DropdownMenuLabel`, `DropdownMenuSub`).",
	],
	alternatives: [
		{
			name: "ContextMenu",
			when: "The menu has no visible trigger and opens at the pointer on right-click or long press.",
		},
		{
			name: "Command",
			when: "The list is long or searchable — open tabs, branches, files — and needs a filter field.",
		},
		{
			name: "SegmentedControl",
			when: "Two to four always-visible options where the choice should stay on screen.",
		},
		{
			name: "Popover",
			when: "The panel holds a form, editable rows or rich content rather than a list of commands; reuse `menuItemClass` for its rows.",
		},
	],
	anatomy: [
		{
			part: "DropdownMenu",
			description:
				"Radix Root. Owns open state, uncontrolled by default or `open` / `onOpenChange`.",
		},
		{
			part: "DropdownMenuTrigger",
			description:
				"Radix Trigger, unstyled. With `asChild` it lends its ARIA and `data-state` to a Button or IconButton.",
		},
		{
			part: "DropdownMenuContent",
			description:
				"Portalled surface: `menuContentClass` (elevated container, default border, `rounded-md`, `--shadow-md`, `p-4`, minimum width) plus a height bounded by the smaller of 60vh and Radix's available height; it scrolls vertically and clips horizontally.",
		},
		{
			part: "DropdownMenuItem",
			description:
				"One row with `menuItemClass`: optional leading icon (sized and muted by the row), label, optional trailing metadata; `tr-text-ui`, `px-8 py-4`, `gap-4`.",
		},
		{
			part: "DropdownMenuLabel",
			description: "A non-interactive section heading in `tr-text-eyebrow` and `text-text-muted`.",
		},
		{
			part: "DropdownMenuGroup",
			description: 'An unstyled `role="group"` wrapper for related items.',
		},
		{
			part: "DropdownMenuRadioGroup / DropdownMenuRadioItem",
			description:
				"A single choice. The item has the row style and `aria-checked`, but no built-in indicator — the call site renders the check.",
		},
		{
			part: "DropdownMenuSeparator",
			description:
				"A full-bleed 1px `border-default` line between sections (`menuSeparatorClass`).",
		},
		{
			part: "DropdownMenuSub / DropdownMenuSubTrigger / DropdownMenuSubContent",
			description:
				"A nested level. The sub-trigger is a row with a trailing chevron that keeps the selected fill while open; the sub-content is its own portalled surface beside it.",
		},
		{
			part: "menu-styles",
			description:
				"`menuContentClass`, `menuItemClass` and `menuSeparatorClass` from `@thinkrail/ui/menu-styles`: the same surface, row and separator for menu-like rows outside a Radix menu.",
		},
	],
	props: {
		...partProps("DropdownMenu", rootProps),
		...partProps("DropdownMenuTrigger", triggerProps),
		...partProps("DropdownMenuContent", contentProps),
		...partProps("DropdownMenuItem", itemProps),
		...partProps("DropdownMenuLabel", labelProps),
		...partProps("DropdownMenuRadioGroup", radioGroupProps),
		...partProps("DropdownMenuRadioItem", radioItemProps),
		...partProps("DropdownMenuSubTrigger", subTriggerProps),
		...partProps("DropdownMenuSubContent", subContentProps),
	},
	nativeProps: {
		title: "Radix props that pass through",
		props: {
			...partProps("DropdownMenu", {
				defaultOpen: {
					type: "boolean",
					description:
						"Uncontrolled initial state. Every other Radix prop of every part passes through unchanged.",
				},
			} satisfies PartDocs<ComponentProps<typeof DropdownMenu>>),
			...partProps("DropdownMenuContent", {
				loop: {
					type: "boolean",
					default: "false",
					description: "Wrap arrow-key focus from the last item to the first.",
				},
				collisionPadding: {
					type: "number | Partial<Record<Side, number>>",
					default: "0",
					description: "Distance kept from the viewport edges when Radix flips or shifts the menu.",
				},
			} satisfies PartDocs<ComponentProps<typeof DropdownMenuContent>>),
			...partProps("DropdownMenuItem", {
				textValue: {
					type: "string",
					description: "Typeahead text when the item's content is not plain text (a two-line row).",
				},
			} satisfies PartDocs<ComponentProps<typeof DropdownMenuItem>>),
		},
	},
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"One real menu with every part: a heading, a submenu, an enabled and a disabled item, and a radio group. Open it, then hover or arrow through the rows to see the highlight; the disabled row is skipped; ArrowRight opens the submenu, whose trigger keeps its fill while open; choose a radio option to move the check. The trigger shows its selected look while the menu is open.",
		},
	],
	states: [
		{
			state: "Closed",
			how: "Rest.",
			appearance: 'Only the trigger is rendered; it carries `data-state="closed"`.',
		},
		{
			state: "Open",
			how: "Click the trigger, or Enter, Space or ArrowDown on it.",
			appearance:
				'The surface appears beside the trigger; the trigger gets `data-state="open"` and `aria-expanded`, so a Button or IconButton trigger shows its selected fill.',
		},
		{
			state: "Highlighted item",
			how: "Pointer over an item, or arrow keys.",
			appearance:
				"`control-bg-selected` fill. Radix focuses the item under the pointer, so hover and keyboard highlight are the same state.",
		},
		{
			state: "Disabled item",
			how: "`disabled`.",
			appearance:
				"Label and icon in `control-disabled-text`; no highlight, skipped by the arrow keys, no pointer events.",
		},
		{
			state: "Checked radio item",
			how: "`DropdownMenuRadioGroup value` equals the item's `value`.",
			appearance:
				'`aria-checked="true"` and `data-state="checked"`; no distinct treatment from the primitive — the call site draws the check.',
		},
		{
			state: "Open submenu",
			how: "Hover the sub-trigger, or ArrowRight / Enter / Space on it.",
			appearance: "The sub-trigger keeps the `control-bg-selected` fill while its submenu is open.",
		},
		{
			state: "Overflowing",
			how: "More rows than fit the viewport or 60vh.",
			appearance:
				"The surface stops at the bound and scrolls; wide rows are clipped, so long labels need `truncate`.",
		},
	],
	accessibility: [
		'The trigger gets `aria-haspopup="menu"`, `aria-expanded` and `aria-controls` from Radix; its accessible name is the Button text or the IconButton `label` — name the subject when there are several (`Actions for {path}`).',
		'The content is `role="menu"`, labelled by the trigger. Items are `menuitem`, radio items `menuitemradio` with `aria-checked`, groups `group`, separators `separator`.',
		"`DropdownMenuLabel` is a visual heading only; it is not wired to the group with `aria-labelledby`.",
		"Disabled items get `aria-disabled` and stay in the list, so the reason written in their label is still read.",
		"The menu is modal: focus moves into it on open and returns to the trigger on close, unless `onCloseAutoFocus` prevents it to hand focus to a dialog or an inline editor.",
		"Explain an item in its label or a second line, not with a tooltip or `title`; menu rows have no tooltip path.",
	],
	keyboard: [
		{
			keys: "Enter / Space / ArrowDown",
			action: "On the trigger: opens the menu; with the keyboard, focus moves to the first item.",
		},
		{
			keys: "ArrowDown / ArrowUp",
			action: "Moves between enabled items; stops at the ends (no wrap).",
		},
		{ keys: "Home / End", action: "First / last enabled item." },
		{ keys: "Letters", action: "Typeahead: jumps to the next item whose text starts with them." },
		{
			keys: "Enter / Space",
			action: "Runs the item (or selects the radio option) and closes the menu.",
		},
		{
			keys: "ArrowRight / ArrowLeft",
			action: "Opens a submenu from its trigger / closes it back to the trigger.",
		},
		{
			keys: "Escape",
			action: "Closes the whole menu, including open submenus, and returns focus to the trigger.",
		},
		{ keys: "Tab", action: "Does nothing inside an open menu; close it first." },
	],
	rules: [
		{
			id: "MNU-1",
			text: "Open a menu from a Button or IconButton through `DropdownMenuTrigger asChild`, so the trigger shows its selected look while open; an icon-only trigger's `label` names what the menu acts on. A hand-styled trigger is reserved for a component that owns its own control (the location-bar pills, a chip).",
		},
		{
			id: "MNU-2",
			text: "Build rows only from the parts — Item, RadioItem, Label, Separator, Sub. Call-site classes are limited to width bounds, `truncate` and content layout. The row sizes and mutes every icon inside it, so a colour class on a row icon has no effect. Menu-like rows outside a Radix menu use `menuItemClass` from `menu-styles`.",
		},
		{
			id: "MNU-3",
			text: "Keep a temporarily unavailable action in place as a `disabled` item whose label says why (`workbench.menu.unavailable`, *No uncommitted changes*); never show an unexplained empty menu.",
		},
		{
			id: "MNU-4",
			text: "A single choice is a `DropdownMenuRadioGroup` of `DropdownMenuRadioItem`s so `aria-checked` follows the value. Draw a check on the current option and a same-size blank on the others so labels align.",
		},
		{
			id: "MNU-5",
			text: "Load menu data on open (controlled `open` / `onOpenChange`), not on mount; show `LoadingRegion` inside the menu while it loads and a disabled item when it is empty.",
		},
		{
			id: "MNU-6",
			text: "Do not set your own height or scrolling on `DropdownMenuContent` or `DropdownMenuSubContent`; both are already bounded by 60vh and the viewport.",
		},
		{
			id: "MNU-7",
			text: "An action that removes something asks first: call `event.preventDefault()` in `onSelect` and open a ConfirmDialog.",
		},
		{
			id: "MNU-8",
			text: "A row with visible actions that should also open on right-click uses one controlled DropdownMenu with two triggers — the menu button (the touch and keyboard path) and the row's `onContextMenu` — not a separate ContextMenu.",
		},
	],
	examples: [
		{
			id: "actions",
			title: "Overflow actions",
			description:
				"A kebab IconButton with icon rows and a separator, aligned to the trigger's end.",
		},
		{
			id: "sections",
			title: "Sections and a heading",
			description:
				"Separators, a `DropdownMenuLabel` and a `DropdownMenuGroup` of truncated recent paths.",
		},
		{
			id: "single-choice",
			title: "Single choice",
			description:
				"A select-like Button opens a radio group as wide as the trigger; the current option shows a check.",
		},
		{
			id: "hints",
			title: "Options with a hint",
			description: "Two-line radio rows under a heading, the check aligned with the first line.",
		},
		{
			id: "submenu",
			title: "Submenu",
			description: "An *Open in* level beside the row's other actions.",
		},
		{
			id: "unavailable",
			title: "Unavailable action",
			description: "A disabled item stays in the menu and its label says why.",
		},
		{
			id: "load-on-open",
			title: "Loaded on open",
			description:
				"A controlled menu fetches its rows when it opens and shows a loading region until they arrive.",
		},
		{
			id: "row-menu",
			title: "Row menu and right-click",
			description:
				"`ChangeRowActions`: a hover-revealed menu button and right-click on the row open the same dropdown.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/PlanPane.tsx",
			note: "Plan header kebab: Copy, Save .md, Open draft PR, Check All.",
		},
		{
			file: "apps/web/src/panels/AddProjectMenu.tsx",
			note: "Separators, a *Recents* label and a group of truncated paths.",
		},
		{
			file: "apps/web/src/shell/locationBar/WorkspaceSegment.tsx",
			note: "*Open in* and *Settled* submenus, a *Switch to* label, trailing shortcut and branch metadata.",
		},
		{
			file: "apps/web/src/panels/AppearanceSettings.tsx",
			note: "Theme picker: radio group as wide as its outline Button trigger.",
		},
		{
			file: "apps/web/src/panels/ChangesScopeMenu.tsx",
			note: "Loads commits on open, `LoadingRegion` while loading, disabled empty and unavailable rows.",
		},
		{
			file: "apps/web/src/panels/ChangeRowActions.tsx",
			note: "One controlled menu opened by a row button and by right-click.",
		},
	],
} satisfies ComponentDoc;
