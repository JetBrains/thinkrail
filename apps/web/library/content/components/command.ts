import type {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	CommandSeparator,
} from "@thinkrail/ui/command";
import type { ComponentProps, HTMLAttributes, InputHTMLAttributes } from "react";
import type { ComponentDoc, PropDoc } from "../types";

/** Props cmdk adds to a part on top of the native element's attributes. */
type Own<P, Native = HTMLAttributes<HTMLDivElement>> = Exclude<
	keyof P,
	keyof Native | "key" | "ref" | "asChild"
>;
type Part<Name extends string, Keys> = `${Name}.${Extract<Keys, string>}`;

type OwnProps =
	// cmdk reuses the native `defaultValue` name for the initially highlighted item.
	| Part<"Command", Own<ComponentProps<typeof Command>> | "defaultValue">
	// cmdk replaces the native `value` with the controlled search string.
	| Part<
			"CommandInput",
			Own<ComponentProps<typeof CommandInput>, InputHTMLAttributes<HTMLInputElement>> | "value"
	  >
	| Part<"CommandList", Own<ComponentProps<typeof CommandList>>>
	| Part<"CommandGroup", Own<ComponentProps<typeof CommandGroup>>>
	// cmdk replaces the native `onSelect` with its own selection callback.
	| Part<"CommandItem", Own<ComponentProps<typeof CommandItem>> | "onSelect">
	| Part<"CommandSeparator", Own<ComponentProps<typeof CommandSeparator>>>
	| Part<"CommandEmpty", Own<ComponentProps<typeof CommandEmpty>>>;

type NativeKeys =
	| Part<"Command", keyof ComponentProps<typeof Command>>
	| Part<"CommandInput", keyof ComponentProps<typeof CommandInput>>
	| Part<"CommandList", keyof ComponentProps<typeof CommandList>>
	| Part<"CommandEmpty", keyof ComponentProps<typeof CommandEmpty>>
	| Part<"CommandGroup", keyof ComponentProps<typeof CommandGroup>>
	| Part<"CommandItem", keyof ComponentProps<typeof CommandItem>>
	| "*.className"
	| "*.asChild"
	| "*.ref";

export const command = {
	slug: "command",
	name: "Command",
	group: "Overlay",
	source: "packages/ui/command.tsx",
	preview: "preview",
	tag: "<Command",
	importLine:
		'import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@thinkrail/ui/command";',
	summary:
		"The searchable list body of every ThinkRail picker and palette — branch, project, model and open-tab pickers and the session switcher. It wraps [cmdk](https://cmdk.paco.me): cmdk owns filtering, ranking, the keyboard highlight and the combobox semantics; the wrapper adds ThinkRail's input, list, group, row and separator styling and a localized list label. The call site provides the surface it sits in (a Popover or Dialog), the rows, their `value`s and what happens `onSelect`.",
	whenToUse: [
		"Picking one value from a list long enough to need search: branches, projects, models, open tabs.",
		"A keyboard palette that jumps somewhere, opened in a Dialog (the `Mod+K` session switcher).",
		"Grouped results under headings (Remote / Local, Pinned / Recent / providers), including nested groups.",
		"Rows that carry a secondary line, a trailing badge, a check for the current value or a small row action.",
	],
	alternatives: [
		{
			name: "DropdownMenu",
			when: "A short, fixed set of actions that needs no search (Rename, Delete, Open in…).",
		},
		{
			name: "ContextMenu",
			when: "The same actions offered on right-click of the object itself.",
		},
		{
			name: "SettingsRadioCards",
			when: "A few mutually exclusive options that should all stay visible in a settings page.",
		},
		{
			name: "SegmentedControl",
			when: "Two to four inline options switched in place, with no list to open.",
		},
	],
	anatomy: [
		{
			part: "Command",
			description:
				"The cmdk root (`[cmdk-root]`): a column with `overflow-hidden` on `container-elevated-bg` and `text-default`. Owns the search, filter and highlight state and the keyboard handling; renders a visually hidden `<label>` with `label`. Focusable (`tabIndex -1`) so a palette without an input can take focus.",
		},
		{
			part: "CommandInput",
			description:
				"A row with a `border-muted` bottom border holding a muted search icon and the `<input>` (`tr-text-ui`, muted placeholder, no outline). `className` reaches the `<input>`, not the row.",
		},
		{
			part: "CommandList",
			description:
				"The scrolling `listbox` with an inner `p-4` inset and a capped height; vertical scroll only. Its `aria-label` defaults to the localized `common.suggestions`.",
		},
		{
			part: "CommandEmpty",
			description:
				"Rendered by cmdk only while no item matches the search: centred `tr-text-ui` in `text-muted`.",
		},
		{
			part: "CommandGroup",
			description:
				"A section of rows with an optional `heading`, padded `px-8 py-4` in `text-muted`. cmdk hides the whole group while none of its items match. Groups nest.",
		},
		{
			part: "CommandItem",
			description:
				"One `option` row: `flex items-center gap-4`, `rounded-sm`, `px-8 py-4`, `tr-text-ui`. The highlighted row (`data-selected`) fills with `control-bg-selected`. Carries `data-row`, so a ghost IconButton inside it uses the raised row-action hover.",
		},
		{
			part: "CommandSeparator",
			description:
				"A `border-muted` hairline with `my-4`, rendered only while the search is empty (unless `alwaysRender`).",
		},
	],
	props: {
		"Command.label": {
			type: "string",
			description:
				"The input's accessible name, rendered as a visually hidden `<label>` that the input is `aria-labelledby`. Without it the combobox has no name — the placeholder does not count. Use a locale key.",
		},
		"Command.shouldFilter": {
			type: "boolean",
			default: "true",
			description:
				"`false` turns off cmdk's filtering and sorting: every rendered item shows and the call site decides what to render (the session switcher, which lists live sessions without a search).",
		},
		"Command.filter": {
			type: "(value: string, search: string, keywords?: string[]) => number",
			description:
				"Custom score from 0 (hidden) to 1 (best match). The model pickers pass `pickerFilter` so a provider header matches when any of its models does.",
		},
		"Command.value": {
			type: "string",
			description:
				"Controlled value of the highlighted item (the keyboard cursor), not the chosen value.",
		},
		"Command.defaultValue": {
			type: "string",
			description:
				"Initially highlighted item value. Without it cmdk highlights the first enabled item.",
		},
		"Command.onValueChange": {
			type: "(value: string) => void",
			description: "Called when the highlighted item changes.",
		},
		"Command.loop": {
			type: "boolean",
			default: "false",
			description: "Arrow keys wrap from the last item to the first and back.",
		},
		"Command.disablePointerSelection": {
			type: "boolean",
			default: "false",
			description: "Pointer movement no longer moves the highlight; clicks still select.",
		},
		"Command.vimBindings": {
			type: "boolean",
			default: "true",
			description:
				"Ctrl+N / Ctrl+J and Ctrl+P / Ctrl+K move the highlight. Set `false` where the surface binds one of those chords itself — the session switcher closes on `Mod+K`, which is Ctrl+K off macOS.",
		},
		"CommandInput.value": {
			type: "string",
			description: "Controlled search text. Pair with `onValueChange`.",
		},
		"CommandInput.onValueChange": {
			type: "(search: string) => void",
			description:
				"Called with the new search text; use it to react to the query (expand groups, show a hint).",
		},
		"CommandList.label": {
			type: "string",
			default: 't("common.suggestions")',
			description:
				"`aria-label` of the listbox. The ThinkRail wrapper defaults it to the localized *Suggestions*; cmdk's own default is English.",
		},
		"CommandGroup.heading": {
			type: "ReactNode",
			description:
				"Visible heading, hidden from assistive tech and used to label the group. Pass a node to add an icon or a type class.",
		},
		"CommandGroup.value": {
			type: "string",
			description: "Unique group id; required when the group has no `heading`.",
		},
		"CommandGroup.forceMount": {
			type: "boolean",
			default: "false",
			description:
				"Keeps the group rendered while none of its own items match — for a parent whose matches live in nested groups.",
		},
		"CommandItem.value": {
			type: "string",
			description:
				"Unique, stable identity used for filtering and highlighting. Inferred from the text content when omitted; pass it whenever labels can repeat or change.",
		},
		"CommandItem.keywords": {
			type: "string[]",
			description: "Extra terms matched by the filter besides `value`.",
		},
		"CommandItem.onSelect": {
			type: "(value: string) => void",
			description: "Called on click and on Enter while highlighted.",
		},
		"CommandItem.disabled": {
			type: "boolean",
			default: "false",
			description:
				"Sets `aria-disabled`; the row is skipped by the keyboard, ignores the pointer and cannot be selected.",
		},
		"CommandItem.forceMount": {
			type: "boolean",
			default: "false",
			description: "Keeps the row rendered regardless of the search.",
		},
		"CommandSeparator.alwaysRender": {
			type: "boolean",
			default: "false",
			description:
				"Keeps the separator while a search is active (useful with `shouldFilter={false}`).",
		},
	} satisfies Record<OwnProps, PropDoc>,
	nativeProps: {
		title: "Native props that matter",
		props: {
			"*.className": {
				type: "string",
				description:
					"Merged onto every part except CommandEmpty. Placement and sizing only: `bg-transparent` on Command inside a surface, a `max-h-*` on CommandList, row layout (`items-start`, `gap-8`, an indent) on CommandItem. On CommandInput it reaches the `<input>`.",
			},
			"CommandInput.placeholder": {
				type: "string",
				description: "The visible prompt (`Search branches…`). Use a locale key.",
			},
			"CommandItem.children": {
				type: "ReactNode",
				description:
					"The row content: a leading icon (`size-14`), a truncated label, optional secondary line, badge or check.",
			},
			"CommandEmpty.children": {
				type: "ReactNode",
				description: "The no-match message. Use a locale key.",
			},
			"*.asChild": {
				type: "boolean",
				description:
					"cmdk's slot composition on the root, list, group, item and separator. Unused in ThinkRail.",
			},
			"*.ref": {
				type: "Ref<HTMLDivElement | HTMLInputElement>",
				description: "Forwarded to the part's element (React 19 ref prop).",
			},
		} satisfies Partial<Record<NativeKeys, PropDoc>>,
	},
	states: [
		{
			state: "Rest",
			how: "No search; pointer outside the list.",
			appearance:
				"Rows on the surface with no fill except the highlighted one: cmdk highlights the first enabled item on mount.",
		},
		{
			state: "Highlighted",
			how: "Pointer moves over a row (unless `disablePointerSelection`), or the arrow keys, Home / End.",
			appearance:
				"`control-bg-selected` fill on the row (`data-selected`, `aria-selected`). There is no separate hover treatment: hover moves the highlight.",
		},
		{
			state: "Input focus",
			how: "Click or Tab into the input.",
			appearance:
				"No distinct treatment — the input has no outline; the highlighted row shows where Enter goes.",
		},
		{
			state: "Root focus",
			how: "A palette without an input focuses `[cmdk-root]` on open.",
			appearance:
				"No ThinkRail treatment: the root sets no outline style, so the browser's default focus outline draws around the list.",
		},
		{
			state: "Filtered",
			how: "Typing in the input.",
			appearance:
				"Non-matching rows unmount, rows are ranked by score, groups with no match are hidden, separators disappear; the first match is highlighted.",
		},
		{
			state: "Empty",
			how: "The search matches nothing.",
			appearance: "CommandEmpty shows its centred muted message; nothing else in the list renders.",
		},
		{
			state: "Disabled item",
			how: "`disabled` on CommandItem.",
			appearance:
				"No distinct treatment: the row looks like an enabled one but cannot be highlighted or selected.",
		},
		{
			state: "Row action",
			how: "A ghost IconButton inside a row.",
			appearance:
				"The row's `data-row` gives the button a `container-elevated-bg` hover, so it stays visible on a highlighted row.",
		},
	],
	accessibility: [
		'The input is a `combobox` (`aria-autocomplete="list"`, `aria-controls` the list, `aria-activedescendant` the highlighted row); focus stays in the input while the highlight moves.',
		"The input is `aria-labelledby` the root's visually hidden `<label>`, which holds Command `label`. Without `label` that label is empty and the combobox is unnamed — the placeholder is not used — so always pass one.",
		"The list is a `listbox` named by CommandList `label` (localized *Suggestions* by default); rows are `option`s with `aria-selected` on the highlight and `aria-disabled` when disabled.",
		"A group's items form a `group` labelled by its heading; the heading element itself is `aria-hidden`, so the heading text is announced once.",
		"A row that expands a group (the model pickers' provider headers) sets `aria-expanded` itself.",
		"The surrounding Popover or Dialog owns focus trapping, Escape and focus return. A palette without an input focuses `[cmdk-root]` in `onOpenAutoFocus` so the arrows work at once.",
	],
	keyboard: [
		{ keys: "Type", action: "Filters and ranks the rows; the first match is highlighted." },
		{
			keys: "ArrowDown / ArrowUp",
			action: "Moves the highlight to the next / previous enabled row; wraps with `loop`.",
		},
		{
			keys: "Ctrl+N / Ctrl+J, Ctrl+P / Ctrl+K",
			action: "Same as ArrowDown / ArrowUp while `vimBindings` is on (the default).",
		},
		{
			keys: "Alt+ArrowDown / Alt+ArrowUp",
			action: "Jumps to the first row of the next / previous group.",
		},
		{ keys: "Meta+ArrowDown / Meta+ArrowUp", action: "Jumps to the last / first row." },
		{
			keys: "Home / End",
			action: "Jumps to the first / last row (cmdk takes these keys from the input caret).",
		},
		{ keys: "Enter", action: "Runs the highlighted row's `onSelect`." },
		{ keys: "Escape", action: "Closes the Popover or Dialog the list sits in (Radix)." },
		{ keys: "Tab", action: "Leaves the input; rows are not tab stops." },
	],
	rules: [
		{
			id: "CMD-1",
			text: "Use Command for a searchable choice or a keyboard palette, mounted inside PopoverContent (`p-0`) or DialogContent (`p-0 gap-0`); the surface supplies border, radius and shadow. A short action list without search is a DropdownMenu.",
		},
		{
			id: "CMD-2",
			text: "Pass Command `label` from a locale key whenever there is a CommandInput; it is the input's only accessible name.",
		},
		{
			id: "CMD-3",
			text: "Give every CommandItem a stable, unique `value` — an id or the full ref — and put the display name and other search terms in `keywords`. Never rely on inferred text values when labels can repeat or change.",
		},
		{
			id: "CMD-4",
			text: "Act in `onSelect`, never `onClick`: it runs for both click and Enter. Close the overlay there, and reset a controlled query.",
		},
		{
			id: "CMD-5",
			text: "The highlight (`data-selected`) is the keyboard cursor, not the chosen value. Mark the current value inside the row — a check in a fixed slot — so it stays visible wherever the highlight is.",
		},
		{
			id: "CMD-6",
			text: "CommandEmpty is for *no match*, with a locale key. When you filter yourself (`shouldFilter={false}`) or the source list is empty, render your own message: CommandEmpty only follows cmdk's match count.",
		},
		{
			id: "CMD-7",
			text: "A row action is an `IconButton` (ghost, size `s`) whose `onClick` calls `event.stopPropagation()`, so pressing it does not select the row.",
		},
		{
			id: "CMD-8",
			text: "Style a group heading by passing a node (`heading={<span …>}`); a `[&_[cmdk-group-heading]]:tr-*` class produces nothing (TYPOGRAPHY.md, *When the element is not yours*).",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Grouped picker",
			description:
				"The body every picker starts from — input, two headed groups and a no-match message — in a Popover opened by a Button.",
		},
		{
			id: "branch-picker",
			title: "Branch picker",
			description:
				"A Popover picker with nested Remote groups, a check for the current branch and a default badge; picking closes it.",
		},
		{
			id: "tab-search",
			title: "Open-tab search",
			description:
				"An IconButton opens the list; each row's `value` is the tab id and its name and kind are `keywords`.",
		},
		{
			id: "session-palette",
			title: "Palette in a dialog",
			description:
				"The session switcher pattern: no input, `shouldFilter={false}`, `loop`, icon headings, two-line rows and the root focused on open.",
		},
		{
			id: "model-groups",
			title: "Collapsible groups",
			description:
				"A model picker whose provider headers are rows with `aria-expanded`; a controlled search expands every group and a header matches through its models' `keywords`.",
		},
		{
			id: "row-action",
			title: "Row action",
			description:
				"A pin toggle inside the row that does not select it, revealed on row hover or highlight.",
		},
		{
			id: "separator",
			title: "Separator",
			description:
				"A project picker where CommandSeparator sets an Add project action apart; it disappears while searching. No production list uses the separator yet.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/BranchPicker.tsx",
			note: "Branch picker in a Popover: nested Remote groups with `forceMount`, Local group, check and default badge.",
		},
		{
			file: "apps/web/src/chat/ModelSelector.tsx",
			note: "Model picker: controlled search, custom `filter`, collapsible provider groups, pin row action.",
		},
		{
			file: "apps/web/src/chat/ModelEffortPicker.tsx",
			note: "Composer model + effort picker: Default, Pinned, Recent and provider groups above the effort slider.",
		},
		{
			file: "apps/web/src/shell/SessionSwitcher.tsx",
			note: "`Mod+K` palette in a Dialog: no input, `shouldFilter={false}`, `loop`, `vimBindings={false}`.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchTabs.tsx",
			note: "Open-tab search behind an IconButton, with tab ids as values and names as `keywords`.",
		},
		{
			file: "apps/web/src/panels/NewWorkspaceDialog.tsx",
			note: "Project picker pill in the New workspace dialog.",
		},
	],
} satisfies ComponentDoc;
