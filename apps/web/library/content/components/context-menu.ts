import type {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@thinkrail/ui/context-menu";
import type { ComponentProps } from "react";
import { type PartDocs, partProps } from "../parts";
import type { ComponentDoc } from "../types";

const rootProps = {
	open: {
		type: "boolean",
		description:
			"Controlled open state — to keep the row highlighted while its menu is open, or to close the menu before opening a dialog.",
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
} satisfies PartDocs<ComponentProps<typeof ContextMenu>>;

const triggerProps = {
	asChild: {
		type: "boolean",
		description:
			"Merges the trigger onto its child — the row element that owns the gesture. Without it the trigger renders a `<span>`.",
	},
	disabled: {
		type: "boolean",
		default: "false",
		description: "Stops opening; right-click then falls through to the browser's own menu.",
	},
	onKeyDown: {
		type: "KeyboardEventHandler",
		description:
			"Radix has no keyboard opener. Handle the Context Menu key and Shift+F10 here and dispatch a `contextmenu` event at the row (see the Keyboard example).",
	},
} satisfies PartDocs<ComponentProps<typeof ContextMenuTrigger>>;

const contentProps = {
	onCloseAutoFocus: {
		type: "(event: Event) => void",
		description:
			"Runs before focus returns. Call `event.preventDefault()` when an item hands focus to a dialog or an inline editor, then restore focus yourself.",
	},
	className: {
		type: "string",
		description:
			"Width bounds only. Surface, padding and the height bound come from the wrapper; position is Radix's (right of the pointer, start-aligned, flipped on collision) and cannot be changed.",
	},
} satisfies PartDocs<ComponentProps<typeof ContextMenuContent>>;

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
		description: "Content layout only; the row style comes from `menuItemClass`.",
	},
} satisfies PartDocs<ComponentProps<typeof ContextMenuItem>>;

export const contextMenu = {
	slug: "context-menu",
	name: "ContextMenu",
	group: "Overlay",
	source: "packages/ui/context-menu.tsx",
	preview: "project-row",
	tag: "<ContextMenuContent",
	importLine:
		'import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@thinkrail/ui/context-menu";',
	summary:
		"A menu that opens at the pointer when a row or tab is right-clicked, or long-pressed on touch. It is Radix ContextMenu with the same surface, rows and separators as DropdownMenu (`menu-styles`), portalled and bounded to the viewport. It exports only items and separators; the call site provides the trigger element, the actions and — because the trigger has no visible affordance — another path to the same actions.",
	whenToUse: [
		"Secondary actions on a row or tab that has no visible menu button: a project row, a workbench tab.",
		"Actions that belong to the thing under the pointer, without selecting or opening it first.",
		"A flat list of actions, optionally split into sections by separators.",
	],
	alternatives: [
		{
			name: "DropdownMenu",
			when: "The row has a visible menu button, the menu needs a heading, a single choice or a submenu, or right-click should open the same menu as a button (`ChangeRowActions`).",
		},
		{
			name: "IconButton",
			when: "The action is primary for the row (Create workspace `+`): keep it visible and repeat it in the context menu.",
		},
		{ name: "Command", when: "The user is looking for an action by name across the app." },
	],
	anatomy: [
		{
			part: "ContextMenu",
			description:
				"Radix Root. Owns open state, uncontrolled by default or `open` / `onOpenChange`.",
		},
		{
			part: "ContextMenuTrigger",
			description:
				"The area that reacts to right-click and a touch long press. Unstyled and without ARIA; with `asChild` it is the row itself.",
		},
		{
			part: "ContextMenuContent",
			description:
				"Portalled surface placed at the pointer: `menuContentClass` plus a height bounded by the smaller of 60vh and Radix's available height, scrolling vertically.",
		},
		{
			part: "ContextMenuItem",
			description:
				"One row with `menuItemClass`: optional leading icon (sized and muted by the row) and label.",
		},
		{
			part: "ContextMenuSeparator",
			description: "A full-bleed 1px line between sections (`menuSeparatorClass`).",
		},
	],
	props: {
		...partProps("ContextMenu", rootProps),
		...partProps("ContextMenuTrigger", triggerProps),
		...partProps("ContextMenuContent", contentProps),
		...partProps("ContextMenuItem", itemProps),
	},
	nativeProps: {
		title: "Radix props that pass through",
		props: {
			...partProps("ContextMenuContent", {
				loop: {
					type: "boolean",
					default: "false",
					description:
						"Wrap arrow-key focus from the last item to the first. Every other Radix prop of every part passes through unchanged; the wrapper adds none.",
				},
				alignOffset: {
					type: "number",
					default: "0",
					description: "Shifts the menu along the pointer's vertical axis.",
				},
			} satisfies PartDocs<ComponentProps<typeof ContextMenuContent>>),
			...partProps("ContextMenuItem", {
				textValue: {
					type: "string",
					description: "Typeahead text when the item's content is not plain text.",
				},
			} satisfies PartDocs<ComponentProps<typeof ContextMenuItem>>),
		},
	},
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Each row is the real component with a real menu. Hover or arrow through the items to see the highlight; the disabled item is skipped.",
			table: {
				head: ["Trigger", "Try"],
				rows: [
					[
						"`enabled`",
						"Right-click, long-press, or Tab to the row and press Shift+F10. The row stays highlighted while open; the second item is disabled.",
					],
					["`disabled`", "Right-click opens the browser's own menu."],
				],
			},
		},
	],
	states: [
		{
			state: "Closed",
			how: "Rest.",
			appearance:
				'Only the trigger element; it carries `data-state="closed"` and no styling from the menu.',
		},
		{
			state: "Open",
			how: "Right-click the trigger, long-press it on touch, or the call site's keyboard opener.",
			appearance:
				'The surface appears at the pointer; the trigger gets `data-state="open"`. The menu draws nothing on the trigger — a row that should stay highlighted reads controlled `open`.',
		},
		{
			state: "Highlighted item",
			how: "Pointer over an item, or arrow keys.",
			appearance: "`control-bg-selected` fill; hover and keyboard highlight are the same state.",
		},
		{
			state: "Disabled item",
			how: "`disabled`.",
			appearance:
				"Label and icon in `control-disabled-text`; no highlight, skipped by the arrow keys, no pointer events.",
		},
		{
			state: "Disabled trigger",
			how: "`ContextMenuTrigger disabled`.",
			appearance: "No distinct treatment; the browser's native menu opens instead.",
		},
		{
			state: "Overflowing",
			how: "More rows than fit the viewport or 60vh.",
			appearance: "The surface stops at the bound and scrolls.",
		},
	],
	accessibility: [
		"The trigger gets no ARIA and is not announced as having a menu, so nothing may live only in a context menu: keep a visible control or a keyboard path for every action.",
		"Radix opens the menu only from a pointer. Rows that take keyboard focus add the Context Menu key and Shift+F10 on the trigger, as the project rows do.",
		'The content is `role="menu"`; items are `menuitem` with `aria-disabled` when disabled; separators are `separator`.',
		"Focus moves into the menu on open and back to the previously focused element on close, unless `onCloseAutoFocus` prevents it.",
		"Write the reason for a disabled item into its label, not into a tooltip or `title`; menu rows have no tooltip path.",
	],
	keyboard: [
		{
			keys: "Context Menu key / Shift+F10",
			action: "Opens the menu under the focused row — only where the call site adds the handler.",
		},
		{
			keys: "ArrowDown / ArrowUp",
			action: "Moves between enabled items; stops at the ends (no wrap).",
		},
		{ keys: "Home / End", action: "First / last enabled item." },
		{ keys: "Letters", action: "Typeahead: jumps to the next item whose text starts with them." },
		{ keys: "Enter / Space", action: "Runs the item and closes the menu." },
		{ keys: "Escape", action: "Closes the menu; focus returns to where it was." },
		{ keys: "Tab", action: "Does nothing inside an open menu; close it first." },
	],
	rules: [
		{
			id: "CTX-1",
			text: "A context menu is a shortcut, never the only way: every action in it is also reachable by a visible control, a keyboard path or a shortcut — touch has no right-click and long press is not discoverable.",
		},
		{
			id: "CTX-2",
			text: "If the row takes keyboard focus, open the same menu from the Context Menu key and Shift+F10 on the trigger.",
		},
		{
			id: "CTX-3",
			text: "Opening the menu must not select, open or navigate the row it belongs to; wrap the whole row with `ContextMenuTrigger asChild` so right-click works anywhere on it.",
		},
		{
			id: "CTX-4",
			text: "Keep it a flat list of items and separators. When the menu needs a heading, a single choice or a submenu, or the row has a visible menu button, use a DropdownMenu (with right-click opening it) instead.",
		},
		{
			id: "CTX-5",
			text: "Keep an unavailable action in place as a `disabled` item whose label says why (*Move left — already first*).",
		},
		{
			id: "CTX-6",
			text: "To open a dialog from an item, call `event.preventDefault()` in `onSelect`, close the menu, open the dialog on the next frame and manage focus in `onCloseAutoFocus`.",
		},
	],
	examples: [
		{
			id: "project-row",
			title: "Row actions",
			description: "Right-click (or long-press) the row: icon items in two sections.",
		},
		{
			id: "row-with-actions",
			title: "Row with its own button",
			description:
				"The trigger wraps the whole row; the visible `+` stays the direct path and the menu repeats it.",
		},
		{
			id: "keyboard",
			title: "Keyboard opener",
			description: "Tab to the row and press Shift+F10 or the Context Menu key.",
		},
		{
			id: "open-highlight",
			title: "Highlight while open",
			description: "Controlled `open` keeps the row highlighted while its menu is open.",
		},
		{
			id: "tab-actions",
			title: "Sections and unavailable actions",
			description:
				"Tab actions split by separators; the unavailable ones stay disabled with the reason in the label.",
		},
		{
			id: "confirm-after-menu",
			title: "Confirm after the menu",
			description:
				"An item closes the menu first, opens a ConfirmDialog on the next frame, and focus returns to the row when the dialog closes.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ProjectTree.tsx",
			note: "Project row menu: Shift+F10 / Context Menu key opener, controlled `open` for the row highlight, dialogs opened after the menu closes.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchTabs.tsx",
			note: "Tab menu: focus, rename, move and split actions with separators and disabled-with-reason items.",
		},
	],
} satisfies ComponentDoc;
