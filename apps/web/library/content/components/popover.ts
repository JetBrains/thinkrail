import type { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";
import type { ComponentProps } from "react";
import type { ComponentDoc, PropDoc } from "../types";

/** Docs for some of a part's props, checked against its real props. */
type PartDocs<P> = Partial<Record<keyof P, PropDoc>>;
type ContentProps = ComponentProps<typeof PopoverContent>;
/** What the ThinkRail wrapper adds to or changes on Radix `Popover.Content`; must exist on the real props. */
type ContentOwnProps = Pick<
	Record<keyof ContentProps, PropDoc>,
	"container" | "align" | "sideOffset"
>;

/** Prefixes each prop of a part with the part's name, so one table lists every part. */
function partProps(part: string, docs: Readonly<Record<string, PropDoc>>) {
	return Object.fromEntries(
		Object.entries(docs).map(([name, doc]) => [`${part}.${name}`, doc]),
	) as Record<string, PropDoc>;
}

const contentOwnProps = {
	container: {
		type: "HTMLElement | null",
		description:
			"The element the content portals into; `null` or omitted portals to `document.body`. Pass the host DialogContent node (`ref={setDialogEl}`) when the popover opens inside a modal dialog, so its list scrolls under the dialog's scroll lock.",
	},
	align: {
		type: '"start" | "center" | "end"',
		default: '"center"',
		description:
			"Alignment against the trigger. Call sites use `start` under a left-edge trigger (pickers, branch details) and `end` for a trailing icon trigger (chat history, tab search, send options).",
	},
	sideOffset: {
		type: "number",
		default: "6",
		description: "Gap to the trigger. The wrapper sets 6; Radix's own default is 0.",
	},
} satisfies ContentOwnProps;

const rootProps = {
	open: {
		type: "boolean",
		description:
			"Controlled open state. Every production popover controls it, so a row can close it after a choice or a second control can open it.",
	},
	onOpenChange: {
		type: "(open: boolean) => void",
		description:
			"Called on every open and close (trigger, Escape, outside click, focus leaving). Start a refresh here when the content loads on open (`if (next) refresh()`).",
	},
	defaultOpen: {
		type: "boolean",
		default: "false",
		description: "Uncontrolled initial state, for a popover nothing else needs to close.",
	},
	modal: {
		type: "boolean",
		default: "false",
		description:
			"Traps focus, blocks outside pointer events and locks page scroll while open. No ThinkRail call site sets it; popovers stay non-modal.",
	},
} satisfies PartDocs<ComponentProps<typeof Popover>>;

const triggerProps = {
	asChild: {
		type: "boolean",
		description:
			"Merges the trigger onto its child. Use it with a Button or IconButton, which shows its selected look while `data-state=\"open\"`. An IconButton child also needs `wrapTrigger`, which keeps its tooltip's and the popover's `data-state` on separate elements.",
	},
	disabled: {
		type: "boolean",
		description: "Blocks opening. With `asChild`, set `disabled` on the Button child instead.",
	},
} satisfies PartDocs<ComponentProps<typeof PopoverTrigger>>;

const anchorProps = {
	asChild: {
		type: "boolean",
		description:
			"Merges the anchor onto its child. While a PopoverAnchor is mounted the content positions against it instead of the trigger.",
	},
} satisfies PartDocs<ComponentProps<typeof PopoverAnchor>>;

const contentRadixProps = {
	side: {
		type: '"top" | "right" | "bottom" | "left"',
		default: '"bottom"',
		description:
			"Preferred side; Radix flips and shifts the content when the viewport is too small. `top` for triggers at the bottom of a surface (the composer's send options).",
	},
	onOpenAutoFocus: {
		type: "(event: Event) => void",
		description:
			"Runs before focus moves into the content (by default its first focusable element). `event.preventDefault()` and focus something else — the content itself (branch details) or an input.",
	},
	onCloseAutoFocus: {
		type: "(event: Event) => void",
		description:
			"Runs before focus returns to the trigger. `event.preventDefault()` when a choice should move focus elsewhere (the tab it selected).",
	},
	onEscapeKeyDown: {
		type: "(event: KeyboardEvent) => void",
		description:
			"`event.preventDefault()` keeps the popover open, for example while an inline rename inside it owns Escape.",
	},
	className: {
		type: "string",
		description:
			"Width (`w-288`, `w-320`, `min-w-[16rem]`), padding by content (`p-0` around a Command, `p-4` around rows, `p-12` around details and forms), layout and a height bound such as `max-h-[min(60vh,var(--radix-popover-content-available-height))] overflow-y-auto`. The surface, border, radius and shadow come from the wrapper.",
	},
	ref: {
		type: "Ref<HTMLDivElement>",
		description:
			'The content element (`role="dialog"`, `tabIndex={-1}`), for focusing it from `onOpenAutoFocus`.',
	},
} satisfies PartDocs<ContentProps>;

export const popover = {
	slug: "popover",
	name: "Popover",
	group: "Overlay",
	source: "packages/ui/popover.tsx",
	preview: "preview",
	tag: "<PopoverContent",
	importLine:
		'import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@thinkrail/ui/popover";',
	summary:
		"A non-modal floating panel anchored to a trigger: Radix Popover with ThinkRail's elevated surface. `PopoverContent` owns the portal (to the body or a given `container`), placement next to the trigger with a fixed offset, the border, radius and shadow, and Radix's focus, Escape and outside-click handling. The call site provides the trigger, the content, its width and padding, and usually the open state.",
	whenToUse: [
		"A searchable picker behind a select-like trigger: branches, projects, models, open tabs — a Command inside the popover.",
		"Details about the control that opened it, with a few actions: the branch segment's facts and Copy branch name.",
		"A short list of rows that needs more than a menu row allows — a meaning line per option, inline rename, per-row actions (recently closed chats, send options).",
		"A small form tied to one control: naming a new layout preset.",
		"A yes/no anchored to the control that asked — use ConfirmPopover, which is built on it.",
	],
	alternatives: [
		{
			name: "DropdownMenu",
			when: "The panel is a list of commands or one choice among a few: it brings menu roles, arrow keys and typeahead.",
		},
		{
			name: "Dialog",
			when: "The task needs the user's full attention, blocks the page or has no on-screen anchor.",
		},
		{
			name: "Tooltip and IconTooltip",
			when: "The text only explains a control and contains nothing interactive.",
		},
		{
			name: "ConfirmPopover",
			when: "The panel only asks to confirm one action; it fixes the layout, roles and buttons.",
		},
	],
	anatomy: [
		{
			part: "Popover",
			description:
				"Radix Root. Owns the open state, uncontrolled by default or `open` / `onOpenChange`; non-modal.",
		},
		{
			part: "PopoverTrigger",
			description:
				'Radix Trigger, unstyled: toggles on click and carries `aria-haspopup="dialog"`, `aria-expanded`, `aria-controls` and `data-state`. Usually `asChild` on a Button or IconButton.',
		},
		{
			part: "PopoverAnchor",
			description:
				"Radix Anchor: positions the content against another element than the trigger. Exported, but no production call site uses it yet.",
		},
		{
			part: "PopoverContent",
			description:
				'The portalled panel (`role="dialog"`): `z-50`, `rounded-md`, `border-border-default`, `bg-container-elevated-bg`, `text-text-default`, `--shadow-md`, `overflow-hidden`, no outline and no padding of its own.',
		},
	],
	props: {
		...partProps("PopoverContent", contentOwnProps),
		...partProps("Popover", rootProps),
		...partProps("PopoverTrigger", triggerProps),
		...partProps("PopoverAnchor", anchorProps),
	},
	nativeProps: {
		title: "Radix PopoverContent props that pass through",
		props: contentRadixProps,
	},
	states: [
		{
			state: "Closed",
			how: "Rest.",
			appearance: 'The content is unmounted; the trigger carries `data-state="closed"`.',
		},
		{
			state: "Open",
			how: "Click the trigger, Enter or Space on it, or `open`.",
			appearance:
				'The panel appears on `side` with the wrapper\'s offset; the trigger gets `data-state="open"` and `aria-expanded`, so a Button or IconButton trigger shows its selected fill.',
		},
		{
			state: "Flipped",
			how: "Not enough room on `side`.",
			appearance:
				"Radix moves the panel to the opposite side or shifts it along the edge; no distinct treatment otherwise.",
		},
		{
			state: "Inside a dialog",
			how: "`container` set to the DialogContent node.",
			appearance:
				"Same panel, portalled inside the dialog so it scrolls and receives the wheel under the dialog's scroll lock.",
		},
		{
			state: "Entering and leaving",
			how: "Opening or closing.",
			appearance: "No distinct treatment: the wrapper has no enter or exit animation.",
		},
		{
			state: "Focus inside",
			how: "Focus on the content element itself.",
			appearance:
				"No distinct treatment: the panel has `outline-none`; focused controls inside show their own focus ring.",
		},
	],
	accessibility: [
		'The content is `role="dialog"`; give it a name with `aria-label` or `aria-labelledby` on its heading, as the chat history popover does.',
		'The trigger is a native button with `aria-haspopup="dialog"`, `aria-expanded` and `aria-controls` from Radix; an icon-only trigger is an IconButton with a `label`.',
		"Non-modal: the rest of the page stays interactive and readable, nothing is hidden from assistive tech and the page does not scroll-lock.",
		"On open, focus moves to the first focusable element in the content, or to the content itself when there is none. Redirect it with `onOpenAutoFocus`.",
		"On Escape or a choice, focus returns to the trigger; after an outside click it stays where the user clicked. Redirect it with `onCloseAutoFocus`.",
		"A popover is not a menu: rows are plain buttons in Tab order, without menu roles or arrow keys. A Command inside adds combobox semantics and arrow-key navigation.",
	],
	keyboard: [
		{ keys: "Enter / Space", action: "On the trigger: opens or closes the popover." },
		{
			keys: "Tab / Shift+Tab",
			action: "Moves through the content's controls and wraps from the last to the first.",
		},
		{
			keys: "Escape",
			action:
				"Closes the popover and returns focus to the trigger (one Escape also closes an open tooltip).",
		},
		{
			keys: "ArrowUp / ArrowDown / Enter",
			action: "Inside a Command: move the highlight and choose the item.",
		},
	],
	rules: [
		{
			id: "POP-1",
			text: "Use a Popover for an anchored panel with its own content — a picker, details, a short form. A list of commands is a DropdownMenu; a modal task is a Dialog; a lone confirmation is a ConfirmPopover.",
		},
		{
			id: "POP-2",
			text: "Open it from a real trigger: `PopoverTrigger asChild` on a Button or IconButton, which then shows the open state. Add `wrapTrigger` to an IconButton trigger; never hand-roll a tooltip span around it.",
		},
		{
			id: "POP-3",
			text: "Inside a modal Dialog pass `container={dialogEl}` (the DialogContent node) so the popover stays inside the dialog's scroll lock.",
		},
		{
			id: "POP-4",
			text: "The wrapper owns the surface; the call site sets only width, padding by content (`p-0` around a Command, `p-4` around rows, `p-12` around details) and layout. Bound a list's height with Radix's available height and let it scroll.",
		},
		{
			id: "POP-5",
			text: "Control `open` and close the popover yourself after a choice; start any data refresh in `onOpenChange` when it opens.",
		},
		{
			id: "POP-6",
			text: "Name the panel with `aria-label` or `aria-labelledby`, and move focus on purpose: `onOpenAutoFocus` to the content or an input, `onCloseAutoFocus` to what the choice selected.",
		},
		{
			id: "POP-7",
			text: "Reuse shared rows inside: Command parts for searchable lists and `menuItemClass` for plain rows. Do not restyle the panel.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Details",
			description: "A Button trigger opens facts about it, aligned to its start edge.",
		},
		{
			id: "picker",
			title: "Searchable picker",
			description:
				"The branch picker: a Command in a `p-0` panel, refreshed on open, closing after a choice.",
		},
		{
			id: "in-dialog",
			title: "Inside a dialog",
			description:
				"`container` portals the project picker into the DialogContent so its list scrolls under the dialog's lock.",
		},
		{
			id: "icon-trigger",
			title: "Icon trigger and bounded list",
			description:
				"Chat history: an IconButton with `wrapTrigger`, a labelled panel of `menuItemClass` rows and a height bound.",
		},
		{
			id: "open-upward",
			title: "Opening upward",
			description:
				'Send options under the composer: `side="top"` and `align="end"`; Radix flips the panel down when there is no room above.',
		},
		{
			id: "initial-focus",
			title: "Focus the panel on open",
			description:
				"Branch details focus the content itself, so the Copy button's tooltip does not open.",
		},
		{
			id: "controlled",
			title: "Opened by a second control",
			description:
				"The `to push` chip beside the branch trigger opens the same controlled popover.",
		},
		{
			id: "close-focus",
			title: "Focus the choice on close",
			description:
				"Tab search: `onCloseAutoFocus` moves focus to the chosen tab instead of the trigger.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/BranchPicker.tsx",
			note: "Searchable branch picker: Command in `p-0`, refresh row, `container` for dialogs.",
		},
		{
			file: "apps/web/src/panels/NewWorkspaceDialog.tsx",
			note: "Project picker portalled into the dialog with `container`.",
		},
		{
			file: "apps/web/src/shell/locationBar/BranchSegment.tsx",
			note: "Branch details: content focused in `onOpenAutoFocus`, opened by the remote chips too.",
		},
		{
			file: "apps/web/src/shell/WorkspaceChatHistory.tsx",
			note: "IconButton trigger with `wrapTrigger`, `aria-labelledby`, bounded height, `onEscapeKeyDown` during rename.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchTabs.tsx",
			note: "Open-tab search with `onCloseAutoFocus` focusing the chosen tab.",
		},
		{
			file: "apps/web/src/chat/Composer.tsx",
			note: 'Send options opening upward (`side="top"`, `align="end"`).',
		},
	],
} satisfies ComponentDoc;
