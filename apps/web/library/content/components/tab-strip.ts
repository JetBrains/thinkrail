import type { TabStripProps, WorkbenchTabProps } from "@/shell/layout/workbenchTabs";
import type { ComponentDoc, PropDoc } from "../types";

type WorkbenchTabOwnProps = Exclude<keyof WorkbenchTabProps, keyof TabStripProps>;

const callbacks = {
	onApply: {
		type: "(result: LayoutMutationResult) => void",
		description:
			"Receives one complete pure result (reorder, move, split, new group, remove group) from the tab menu and Alt+Shift+Arrow. Commit `result.document`; never splice tabs yourself.",
	},
	onFocusAdjacentGroup: {
		type: "(delta: -1 | 1, fromGroupId?: string) => void",
		description: "*Focus previous group* / *Focus next group* in the tab menu.",
	},
	onHideSide: {
		type: "(region: LayoutAuxiliaryRegion) => void",
		description: "*Hide left side* / *Hide right side* / *Hide bottom* in an auxiliary tab's menu.",
	},
	onRevealTool: {
		type: "(tool: LayoutToolId) => void",
		description:
			"*Show {tool}* in an auxiliary tab's menu, listed for every tool placed nowhere in `document`.",
	},
	onRenameChat: {
		type: "((sessionId: string, titleInput: string, currentTitle: string) => void) | undefined",
		description:
			"Required key. When set, chat tabs get *Rename chat*, which swaps the label for an inline editor and calls this on commit. Pass `undefined` to omit the item.",
	},
	chatFirstPrompts: {
		type: "Readonly<Record<string, string>>",
		description:
			'First prompt by session id. An unnamed chat (or its plan document) is labelled by it, and the tab\'s native tooltip shows the full prompt. Presentation only; `tab.name` stays `""`.',
	},
	canFocusAdjacentGroup: {
		type: "boolean",
		description:
			"Enables the two *Focus … group* menu items; when `false` they stay listed, disabled, with their unavailable wording.",
	},
	renderTabAdornment: {
		type: "(tab: LayoutTab) => ReactNode",
		description:
			"A small mark after the tab name (the shell's Review flag, the review draft count on the Review tool). Return `null` for none. Keep the identity stable.",
	},
	splitGeometry: {
		type: "{ horizontal: boolean; vertical: boolean }",
		description:
			"Whether the group has room for a left/right or up/down split. A missing direction keeps its *Split …* item disabled with the size it needs.",
	},
} as const satisfies Partial<Record<keyof TabStripProps, PropDoc>>;

export const tabStrip = {
	slug: "tab-strip",
	name: "TabStrip",
	group: "Navigation",
	source: "apps/web/src/shell/layout/workbenchTabs.tsx",
	preview: "preview",
	tag: "<TabStrip",
	importLine: 'import { TabStrip, WorkbenchTab } from "@/shell/layout/workbenchTabs";',
	summary:
		"The workbench's resource tab strip: one fixed-height row of `WorkbenchTab`s for a center group or an auxiliary terminal-session group, implementing WAI-ARIA tabs with roving focus. It owns the tab look, horizontal overflow (hidden scrollbar, edge fades, a searchable list), keyboard reorder, the per-tab context menu with every arrangement command, inline chat rename, drag sources and drop targets. The call site provides the layout `document` and group `location`, the selection and preview ids, and callbacks that commit pure layout results; trailing actions go in `trailing`.",
	whenToUse: [
		"The tab row of a center group: files, diffs, Changes, chats, plan documents and center terminals.",
		"The session tabs of an auxiliary pane whose selected tab is a terminal (left, right or bottom).",
		"Anywhere a group of layout resources must be selectable, closable, reorderable and movable between panes — it is the one renderer of the layout grammar's tabs.",
		"`WorkbenchTab` alone, in `rail` mode, for a placed singleton tool on an edge rail; the rail reuses the same menu and drag controller.",
	],
	alternatives: [
		{
			name: "ToggleSegment",
			when: "Switching between a few named views of one surface; it holds no layout resources.",
		},
		{
			name: "SegmentedControl",
			when: "Choosing one value from a short fixed list in a form or settings row.",
		},
		{
			name: "AuxiliaryPaneHeader",
			when: "An auxiliary pane whose selected tab is a singleton tool or nothing: a plain title, not a strip.",
		},
		{
			name: "DropdownMenu",
			when: "Picking one of many items that do not need to stay visible side by side.",
		},
	],
	anatomy: [
		{
			part: "Strip",
			description:
				"A `h-panel-header-row` row with a bottom border on `container-workspace-bg`; carries `data-area`, `data-group-id` and the group drop cues.",
		},
		{
			part: "Tab list",
			description:
				'`role="tablist"` named after the group (*center group tabs*, *bottom group tabs*…). Scrolls horizontally with the native scrollbar hidden; a vertical wheel scrolls it sideways.',
		},
		{
			part: "Tab",
			description:
				"`WorkbenchTab`: a bordered cell between `min-w-96` and `max-w-192` holding the tab button (kind icon, truncated name, adornment) and its close button.",
		},
		{
			part: "Kind icon",
			description: "From `tabIcon`: the kind's Line icon at rest and its Fill icon when active.",
		},
		{
			part: "Active underline",
			description: "A 2px `primary` bar along the active tab's bottom edge.",
		},
		{
			part: "Close button",
			description:
				"IconButton `ghost` `s`, *Close {name}*, revealed on hover. Not rendered on tool tabs.",
		},
		{
			part: "Insertion markers",
			description:
				"Two invisible half-width zones per tab; the one under a legal drag shows a 2px `primary` edge.",
		},
		{
			part: "Edge fades",
			description:
				"Pointer-transparent fades from `container-workspace-bg`, shown only on a clipped side.",
		},
		{ part: "Trailing", description: "The call site's `trailing` actions, after the tab list." },
		{
			part: "Overflow search",
			description:
				"IconButton *Search open tabs*, only while the list is clipped; opens a Popover with a Command list of the group's tabs.",
		},
		{
			part: "Tab menu",
			description:
				"ContextMenu on every tab: focus, rename, focus groups, keep preview, move, split, move to pane, new group, show tool, hide side, remove group and close.",
		},
	],
	props: {
		document: {
			type: "WorkspaceLayoutDocument",
			description:
				"The projected layout. The strip reads it to decide which menu commands and drop targets are legal and to build the pure results it hands to `onApply`.",
		},
		location: {
			type: "LayoutGroupLocation",
			description:
				"`{ area, groupId }` of this group. `area` names the tab list, sets the test id and decides which menu items exist (center-only splits and keep preview; auxiliary-only new group, show tool and hide).",
		},
		tabs: {
			type: "LayoutTab[]",
			description:
				"The group's tabs in order — a center group's `tabs`, or only the terminals of an auxiliary group.",
		},
		selectedId: {
			type: "string | undefined",
			description:
				"The selected tab: `aria-selected`, the roving `tabIndex={0}`, the active fill and underline, scrolled into view when it changes.",
		},
		previewId: {
			type: "string | undefined",
			description:
				"The group's preview slot (center only): italic name, *Preview — double-click to keep* tooltip, and *Keep preview* enabled in its menu.",
		},
		onSelect: {
			type: "(tabId: string, keep?: boolean) => void",
			description:
				"Click, keyboard navigation and the overflow list. `keep` is `true` when a preview tab is promoted: double-click, a single click on the active preview after the settle window, or *Keep preview*.",
		},
		onClose: {
			type: "(tab: LayoutTab) => void",
			description:
				"Close button, Delete and the menu's *Close*. The workbench routes it through its close request.",
		},
		readAttention: {
			type: "() => LayoutAttention",
			description:
				"Reads the current attention overlay. Used to drop a deferred preview keep when any navigation happened during the settle window.",
		},
		selectionEpochRef: {
			type: "MutableRefObject<number>",
			description:
				"Shared gesture counter. The strip bumps it on every select, close and apply so delayed focus and preview-keep work from an older gesture is skipped.",
		},
		maxSideGroups: {
			type: "number",
			description: "Local left/right group limit, for *New … group* availability.",
		},
		maxBottomGroups: {
			type: "number",
			description: "Local bottom group limit, for *New … group* availability.",
		},
		draggingTab: {
			type: "LayoutTab | null",
			description:
				"The tab being dragged (from the workbench's `DndContext`). While it can join this group, the strip shows its drop hint, enables the insertion markers and adds an *Insert at end* zone.",
		},
		...callbacks,
		trailing: {
			type: "ReactNode",
			description:
				"Actions after the tab list — IconButton `ghost` `m` with `shrink-0 self-center`: New chat, Remove group, the pane's add menu and Hide.",
		},
	} satisfies Record<keyof TabStripProps, PropDoc>,
	nativeProps: {
		title: "WorkbenchTab props (besides the strip props it shares)",
		props: {
			tab: { type: "LayoutTab", description: "The tab to render." },
			index: {
				type: "number",
				description: "Its index in the group, the base for insertion and reorder targets.",
			},
			reorderIndexes: {
				type: "{ previous: number | undefined; next: number | undefined }",
				description:
					"Targets for *Move left/right* (*up/down* on a vertical rail); `undefined` disables that item. Defaults to `index ± 1` within the group.",
			},
			rail: {
				type: "AuxiliaryRailControlProps & { entryKey; vertical; beforeIndex; afterIndex; onActivate }",
				description:
					"Rail mode: an icon-only pressed button in the rail-entry frame with an IconTooltip, roving `tabIndex` from the rail, no close button and *Remove tool from group* instead of *Close*.",
			},
			active: {
				type: "boolean",
				description: "Selected (strip) or pressed (rail).",
			},
			preview: { type: "boolean", description: "This tab holds the group's preview slot." },
			register: {
				type: "(node: HTMLElement | null) => void",
				description:
					"Ref callback for the focusable control, so the strip can focus and reveal it.",
			},
			onClose: { type: "() => void", description: "Closes this tab." },
			panelId: {
				type: "string",
				description: "`aria-controls` target: the group's tab panel (`groupPanelId(location)`).",
			},
			onKeyDown: {
				type: "(event: KeyboardEvent<HTMLButtonElement>) => void",
				description:
					"The tab button's key handler; the strip passes roving focus, reorder and Delete here.",
			},
		} satisfies Record<WorkbenchTabOwnProps | "onClose", PropDoc>,
	},
	states: [
		{
			state: "Rest",
			how: "A tab that is not `selectedId`.",
			appearance: "Muted label and the kind's Line icon; a right border separates tabs.",
		},
		{
			state: "Hover",
			how: "Pointer over a tab.",
			appearance: "The close button appears; the tab itself has no hover fill.",
		},
		{
			state: "Active",
			how: "`selectedId`.",
			appearance:
				"`control-bg-selected` fill, default text, Fill icon and the `primary` underline.",
		},
		{
			state: "Keyboard focus",
			how: "Tab into the list, or arrow between tabs.",
			appearance: "A 2px inset `primary` ring around the whole tab.",
		},
		{
			state: "Preview",
			how: "`previewId`.",
			appearance: "Italic name and the *Preview — double-click to keep* tooltip.",
		},
		{
			state: "Renaming",
			how: "*Rename chat* in a chat tab's menu (needs `onRenameChat`).",
			appearance:
				"The name becomes an inline text field with the chat icon; the close button stays.",
		},
		{
			state: "Dragging",
			how: "Drag a tab more than 5px in a `DndContext`.",
			appearance: "The source tab drops to 40% opacity.",
		},
		{
			state: "Drop hint",
			how: "`draggingTab` can join this group.",
			appearance: "A 1px inset `primary-soft` ring around the strip.",
		},
		{
			state: "Drop active",
			how: "That drag is over the strip.",
			appearance:
				"`primary-subtle` fill and a 2px inset `primary` ring; the insertion marker under the pointer shows a 2px `primary` edge.",
		},
		{
			state: "Overflowing",
			how: "More tabs than fit.",
			appearance: "Edge fades on the clipped sides and the *Search open tabs* button.",
		},
		{
			state: "Empty",
			how: "`tabs={[]}`.",
			appearance: "An empty strip with its trailing actions; no distinct treatment.",
		},
		{
			state: "Disabled",
			how: "—",
			appearance:
				"No distinct treatment: tabs are never disabled. Unavailable menu commands stay listed, disabled, with a reason.",
		},
	],
	accessibility: [
		'The list is `role="tablist"` named by its area; each tab button is `role="tab"` with `aria-selected` and `aria-controls` pointing at the group\'s tab panel.',
		"Roving focus: only the selected tab has `tabIndex={0}`; arrows move selection and focus together.",
		"Each tab advertises its keys with `aria-keyshortcuts`.",
		"The close button is named *Close {name}* and is `tabIndex={-1}`; keyboard users close with Delete.",
		"The tab button's native `title` carries the preview hint or the full first prompt of an unnamed chat.",
		"The rename field is named *Chat name*; Enter and Escape return focus to the tab.",
		"In rail mode the control is a pressed button (`aria-pressed`) named by the tool, with its tooltip opening away from the edge.",
		"Every drag arrangement has a menu or keyboard equivalent; unavailable commands stay in the menu, disabled, with *{label} — {reason}*.",
	],
	keyboard: [
		{
			keys: "Tab",
			action: "Enters the list on the selected tab, then moves on to the trailing actions.",
		},
		{
			keys: "ArrowLeft / ArrowRight",
			action: "Selects and focuses the previous or next tab, wrapping.",
		},
		{ keys: "Home / End", action: "Selects and focuses the first or last tab." },
		{
			keys: "Enter / Space",
			action: "Activates the focused tab; on the active preview tab, keeps it.",
		},
		{ keys: "Delete", action: "Closes the focused tab." },
		{ keys: "Alt+Shift+ArrowLeft / ArrowRight", action: "Moves the tab one place left or right." },
		{
			keys: "Shift+F10 / Menu",
			action: "Opens the tab menu (the browser's context-menu event on the focused tab).",
		},
		{
			keys: "Control+F6 / Control+Shift+F6",
			action: "Next or previous group — handled by the Workbench root, not the strip.",
		},
		{ keys: "Enter / Escape (renaming)", action: "Commits or cancels the new chat name." },
	],
	rules: [
		{
			id: "TAB-1",
			text: "Use TabStrip only for groups of layout resources inside the workbench. To switch views of one surface use ToggleSegment or SegmentedControl; never restyle those into tabs or this into a segmented control.",
		},
		{
			id: "TAB-2",
			text: "Commit what `onApply` hands you (`result.document`) as one pure result; never splice `tabs` or reorder them at the call site.",
		},
		{
			id: "TAB-3",
			text: "Pass `tabs` and the layout `document`, not labels: names come from `layoutTabName` at render, and an unnamed chat is labelled through `chatFirstPrompts`, never by writing a name into the tab.",
		},
		{
			id: "TAB-4",
			text: "Trailing actions are IconButton `ghost` `m` with `shrink-0 self-center`, and a control renders only when it can act (Remove group only on an empty group, Hide on every expanded auxiliary pane).",
		},
		{
			id: "TAB-5",
			text: "Tool tabs have no close glyph; terminals and center resources do. Remove a tool through its menu or Delete, and hide the pane with AuxiliaryPaneHideButton.",
		},
		{
			id: "TAB-6",
			text: "Keep the injected callbacks and `renderTabAdornment` referentially stable and `chatFirstPrompts` shallow-stable; the strip and its tabs are memoized and must not re-render on unrelated attention changes.",
		},
		{
			id: "TAB-7",
			text: "An adornment is a small non-interactive mark after the name; return `null` when there is nothing to show. Never put a button or a second close control in it.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Preview",
			description:
				"A center group with a file and a chat: click or arrow to select, hover to close.",
		},
		{
			id: "center-group",
			title: "Center group",
			description:
				"Every center kind — chat, file, Changes, plan — with the New chat action in `trailing`. Right-click a tab for its menu.",
		},
		{
			id: "preview-tab",
			title: "Preview slot",
			description:
				"`previewId` shows the name in italics. Double-click it, or click it again once active, to keep it.",
		},
		{
			id: "overflow",
			title: "Overflow",
			description:
				"In a narrow group the list scrolls sideways with edge fades, and *Search open tabs* finds any tab.",
		},
		{
			id: "drag-reorder",
			title: "Drag to reorder",
			description:
				"Inside a `DndContext`, drag a tab: the strip shows its drop hint and the insertion marker; dropping commits `moveTabToGroup`.",
		},
		{
			id: "rename-chat",
			title: "Chat names",
			description:
				"An unnamed chat is labelled by its first prompt. *Rename chat* in the tab menu edits the name inline through `onRenameChat`.",
		},
		{
			id: "terminal-strip",
			title: "Terminal sessions",
			description:
				"A bottom pane's session strip with the pane's add menu and AuxiliaryPaneHideButton in `trailing`.",
		},
		{
			id: "empty-group",
			title: "Empty group",
			description:
				"No tabs: the strip keeps its actions. Remove group is disabled with its reason because the last center group always stays.",
		},
		{
			id: "rail-entry",
			title: "WorkbenchTab on a rail",
			description:
				"`WorkbenchTab` in `rail` mode inside AuxiliaryRail: pressed icon buttons that select a tool, or fold the pane when pressed again.",
		},
	],
	usages: [
		{
			file: "apps/web/src/shell/layout/workbenchCenter.tsx",
			note: "Every center group's strip, with preview, split geometry and New chat / Remove group in `trailing`.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchSide.tsx",
			note: "`AuxiliaryGroupHeader`: the terminal-session strip of a left, right or bottom pane, with the add menu and Hide in `trailing`.",
		},
	],
} satisfies ComponentDoc;
