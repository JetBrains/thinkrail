import type { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";
import type { ComponentProps, HTMLAttributes } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type GroupProps = ComponentProps<typeof ResizablePanelGroup>;
type PanelProps = ComponentProps<typeof ResizablePanel>;
type HandleProps = ComponentProps<typeof ResizableHandle>;
/** Library props: everything that is not a plain HTML attribute, plus the attributes the library redefines. */
type Own<P, Redefined extends keyof P = never> =
	| Exclude<keyof P, keyof HTMLAttributes<HTMLElement> | "key">
	| Redefined;
type Part<Name extends string, K> = K extends string ? `${Name}.${K}` : never;
type OwnProps =
	| Part<"ResizablePanelGroup", Own<GroupProps>>
	| Part<"ResizablePanel", Own<PanelProps, "id" | "onResize">>
	| Part<"ResizableHandle", Own<HandleProps>>;
type AllProps =
	| Part<"ResizablePanelGroup", keyof GroupProps>
	| Part<"ResizablePanel", keyof PanelProps>
	| Part<"ResizableHandle", keyof HandleProps>;

export const resizable = {
	slug: "resizable",
	name: "Resizable",
	group: "Layout",
	source: "packages/ui/resizable.tsx",
	preview: "preview",
	tag: "<ResizablePanelGroup",
	importLine:
		'import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@thinkrail/ui/resizable";',
	summary:
		"Split layouts the user can resize: `react-resizable-panels` with ThinkRail's group layout and its hairline separator. It owns the geometry (panel sizes in percent of the group, minimums, maximums, collapse), pointer and keyboard resizing, the separator semantics and optional size persistence; the call site provides the panels' content and surfaces, the sizes and constraints, and — in the workbench — the committed layout it re-applies. `ImperativePanelHandle` and `ImperativePanelGroupHandle` are re-exported for imperative collapse, expand and `setLayout`.",
	whenToUse: [
		"Regions of one window that share its space and that the user sizes: the workbench's side columns, center and bottom panel, Project Home's Projects pane beside Welcome.",
		"Stacked groups in one side or bottom region (Specs above Files), with a vertical group.",
		"A side pane that collapses to nothing and comes back at its last size, driven by a rail button through `ImperativePanelHandle`.",
		"Splitting a center group in two (`workbenchCenter`), with the separator disabled while the group is too small to split.",
	],
	alternatives: [
		{
			name: "Collapsible",
			when: "Content folds in place inside a pane (a long tool output); nothing is resized.",
		},
		{
			name: "TabStrip",
			when: "Several resources share one region and only one shows at a time.",
		},
		{
			name: "QuietScrollArea",
			when: "The content is longer than its fixed region; scroll it instead of letting the user grow the region.",
		},
		{
			name: "Dialog",
			when: "A focused task that temporarily covers the layout instead of taking a share of it.",
		},
	],
	anatomy: [
		{
			part: "ResizablePanelGroup",
			description:
				"`PanelGroup` with `flex h-full w-full`, and `flex-col` when `data-panel-group-direction` is `vertical`. It fills its parent, so give the parent a height (or `flex-1 min-h-0`). Holds the layout: one size per panel, summing to 100.",
		},
		{
			part: "ResizablePanel",
			description:
				"`Panel` itself, re-exported unchanged: a `div` whose `flex-grow` is its size, with `overflow: hidden` and `data-panel`, `data-panel-id`, `data-panel-size` and `data-panel-collapsible`. It has no surface; the child sets the region's background (`bg-container-sidebar-bg`, `bg-container-content-bg`).",
		},
		{
			part: "ResizableHandle",
			description:
				'`PanelResizeHandle` with `role="separator"` between two panels. The element is `w-9` (horizontal) or `h-9` (vertical) with a matching `-mr-8` / `-mb-8`, so it adds a hairline to the layout and overlaps the following panel at `z-10`. Its `::before` is the visible line at the leading edge (`before:w-px` / `before:h-px`) in `border-default`. There is no grip.',
		},
		{
			part: "Hit area",
			description:
				"`hitAreaMargins` extends the pointer target around the element: a fine pointer reaches only one pixel past it, so the preceding panel's trailing scrollbar stays usable; a coarse (touch) pointer gets a wide margin.",
		},
		{
			part: "Imperative handles",
			description:
				"`ref` on a panel gives an `ImperativePanelHandle` (`collapse`, `expand`, `resize`, `getSize`, `isCollapsed`, `isExpanded`); on a group an `ImperativePanelGroupHandle` (`getLayout`, `setLayout`).",
		},
	],
	props: {
		"ResizablePanelGroup.direction": {
			type: '"horizontal" | "vertical"',
			description:
				"Required. `horizontal` lays panels out side by side, `vertical` stacks them. Pass the same value to every ResizableHandle in the group.",
		},
		"ResizablePanelGroup.autoSaveId": {
			type: "string | null",
			default: "null",
			description:
				"Persists the layout in `storage` under this key and restores it on mount (Project Home's `thinkrail-shell-welcome`). Conditional panels need `id` and `order` so each panel set is saved separately.",
		},
		"ResizablePanelGroup.storage": {
			type: "PanelGroupStorage",
			default: "localStorage",
			description: "`getItem` / `setItem` used with `autoSaveId`.",
		},
		"ResizablePanelGroup.keyboardResizeBy": {
			type: "number | null",
			default: "null",
			description:
				"Percent moved per arrow key on a focused handle; `null` moves 10. Shift+arrow always moves to the limit.",
		},
		"ResizablePanelGroup.onLayout": {
			type: "(layout: number[]) => void",
			description:
				"Called with every panel's size on mount and on every change — each pointer move during a drag. Commit on drag end, not here (the workbench projects the drag here and commits from `onDragging(false)`).",
		},
		"ResizablePanelGroup.tagName": {
			type: "keyof HTMLElementTagNameMap",
			default: '"div"',
			description: "The element the group renders.",
		},
		"ResizablePanelGroup.ref": {
			type: "Ref<ImperativePanelGroupHandle>",
			description:
				"`getLayout()` and `setLayout(sizes)` — the workbench re-applies its committed sizes and resets presets through it.",
		},
		"ResizablePanel.id": {
			type: "string",
			description:
				"Stable panel id, used for persistence and `aria-controls`. Required, with `order`, whenever panels are rendered conditionally.",
		},
		"ResizablePanel.order": {
			type: "number",
			description:
				"Position of a conditionally rendered panel, so it returns to the same place when it is added again.",
		},
		"ResizablePanel.defaultSize": {
			type: "number",
			description:
				"Initial size in percent of the group. Read when the panel set changes, not on every render; resize a mounted panel through `ref` or the group's `setLayout`. Defaults in a group should sum to 100.",
		},
		"ResizablePanel.minSize": {
			type: "number",
			default: "0",
			description:
				"Smallest size in percent. Dragging stops here (or collapses when `collapsible`).",
		},
		"ResizablePanel.maxSize": {
			type: "number",
			default: "100",
			description: "Largest size in percent (the workbench's bottom panel cap).",
		},
		"ResizablePanel.collapsible": {
			type: "boolean",
			default: "false",
			description:
				"Lets a drag past `minSize` or Enter on the handle snap the panel to `collapsedSize`.",
		},
		"ResizablePanel.collapsedSize": {
			type: "number",
			default: "0",
			description: "Size of a collapsed panel. ThinkRail always collapses to `0`.",
		},
		"ResizablePanel.onCollapse": {
			type: "() => void",
			description:
				"Called when the panel reaches `collapsedSize` — by drag, keyboard or `collapse()`. Mirror it into the state that hides the pane's content and its handle.",
		},
		"ResizablePanel.onExpand": {
			type: "() => void",
			description: "Called when a collapsed panel grows again.",
		},
		"ResizablePanel.onResize": {
			type: "(size: number, prevSize: number | undefined) => void",
			description: "Called with the panel's new size in percent.",
		},
		"ResizablePanel.tagName": {
			type: "keyof HTMLElementTagNameMap",
			default: '"div"',
			description: "The element the panel renders.",
		},
		"ResizablePanel.ref": {
			type: "Ref<ImperativePanelHandle>",
			description:
				"`collapse()`, `expand(minSize?)`, `resize(size)`, `getSize()`, `isCollapsed()`, `isExpanded()` — how a rail button or `Mod+B` hides and restores a pane.",
		},
		"ResizableHandle.direction": {
			type: '"horizontal" | "vertical"',
			default: '"horizontal"',
			description:
				'Added by ThinkRail. The group\'s direction: picks the line, the cursor (`cursor-col-resize` / `cursor-row-resize`) and `aria-orientation`. It is not read from the group, so a vertical group needs `direction="vertical"` here too.',
		},
		"ResizableHandle.hitAreaMargins": {
			type: "{ coarse: number; fine: number }",
			default: "{ coarse: 15, fine: 1 }",
			description:
				"Pointer margins around the handle. ThinkRail narrows the library's fine margin so the hit area does not cover the preceding panel's scrollbar; keep the default.",
		},
		"ResizableHandle.disabled": {
			type: "boolean",
			default: "false",
			description:
				"Stops pointer and keyboard resizing and the hover colour. The handle stays in the Tab order unless you also pass `tabIndex={-1}`.",
		},
		"ResizableHandle.onDragging": {
			type: "(isDragging: boolean) => void",
			description:
				"`true` on pointer down, `false` on release — where the workbench commits a drag. Keyboard resizing does not call it.",
		},
		"ResizableHandle.tagName": {
			type: "keyof HTMLElementTagNameMap",
			default: '"div"',
			description: "The element the handle renders.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	nativeProps: {
		title: "Passed-through attributes in common use",
		props: {
			"ResizablePanelGroup.className": {
				type: "string",
				description:
					"Merged after the group's own classes. Placement only: `min-h-0 min-w-0 flex-1`, `h-full`.",
			},
			"ResizablePanelGroup.id": {
				type: "string | null",
				description: "Group id; generated when omitted.",
			},
			"ResizableHandle.tabIndex": {
				type: "number",
				default: "0",
				description:
					"`-1` takes a hidden or disabled handle out of the Tab order (Project Home, while Projects is collapsed).",
			},
			"ResizableHandle.aria-hidden": {
				type: "boolean",
				description: "Hides the separator of a collapsed pane from assistive tech.",
			},
			"ResizableHandle.className": {
				type: "string",
				description:
					"Merged last. Only `hidden` for a collapsed pane's handle; never restyle the line.",
			},
			"ResizableHandle.onKeyDownCapture": {
				type: "KeyboardEventHandler",
				description:
					"With `onKeyUpCapture`, how the workbench tracks a keyboard resize and commits it on key up.",
			},
		} satisfies Partial<Record<AllProps, PropDoc>>,
	},
	states: [
		{
			state: "Rest",
			how: "Default.",
			appearance:
				"A hairline in `border-default` at the leading edge of the handle; the pointer cursor is `col-resize` / `row-resize` over the hit area.",
		},
		{
			state: "Hover",
			how: "Pointer within the handle or its hit-area margin.",
			appearance:
				'`data-resize-handle-state="hover"`: the line turns `primary` with the colour transition.',
		},
		{
			state: "Dragging",
			how: "Pointer down on the handle and moving.",
			appearance:
				'`data-resize-handle-state="drag"` and `data-resize-handle-active="pointer"`: the line stays `primary`, the library forces the resize cursor on the whole document (a one-way resize cursor once a limit is reached); `onDragging(true)` fires.',
		},
		{
			state: "Keyboard focus",
			how: "Tab to the handle.",
			appearance:
				'`data-resize-handle-active="keyboard"`. No ThinkRail treatment: the line keeps `border-default` and only the browser\'s default focus outline shows.',
		},
		{
			state: "Collapsed panel",
			how: "`collapsible` panel dragged past `minSize`, Enter on its handle, or `collapse()`.",
			appearance:
				'The panel is at `collapsedSize` (`0`), `onCollapse` fires. The call site hides the handle (`className="hidden"`, `tabIndex={-1}`, `aria-hidden`) and makes the pane `inert`.',
		},
		{
			state: "Disabled",
			how: "`disabled` on the handle.",
			appearance:
				"The line stays `border-default` on hover; no drag or keyboard resize. The resize cursor class and the Tab stop remain.",
		},
	],
	accessibility: [
		'Each handle is a focusable `role="separator"` with `aria-controls` pointing at the panel before it and `aria-valuenow` / `aria-valuemin` / `aria-valuemax` as that panel\'s size in whole percent.',
		"ThinkRail sets `aria-orientation` from `direction`: `vertical` for a side-by-side split (the line is vertical), `horizontal` for a stacked one.",
		"The handle has no accessible name of its own; it is described by the panel it controls. Give that panel a labelled region (`<section aria-label>`), as Project Home and the workbench do.",
		"A collapsed pane is removed from the reading and Tab order by the call site: `inert` and `aria-hidden` on the pane, `tabIndex={-1}` and `aria-hidden` on its handle. Moving focus in and out on collapse is the call site's job (`useCollapsibleRegion`).",
		"Pointer is never the only way: every resize the pointer can make is reachable from the focused handle with the keys below.",
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves focus to and from each handle." },
		{
			keys: "← / → (horizontal), ↑ / ↓ (vertical)",
			action: "Resizes the panel before the handle by `keyboardResizeBy`, or 10 percent.",
		},
		{ keys: "Shift+arrow", action: "Resizes as far as the constraints allow in that direction." },
		{ keys: "Home / End", action: "Shrinks or grows the panel before the handle to its limit." },
		{
			keys: "Enter",
			action:
				"Collapses the panel before the handle when it is `collapsible`, or expands it back to `minSize`.",
		},
		{
			keys: "F6 / Shift+F6",
			action: "Moves focus to the next or previous handle of the same group.",
		},
	],
	rules: [
		{
			id: "RSZ-1",
			text: "Pass the group's `direction` to every ResizableHandle in it; the handle does not read it from the group, and a mismatch draws the wrong line, cursor and `aria-orientation`.",
		},
		{
			id: "RSZ-2",
			text: "Give every panel that can appear or disappear a stable `id` and `order`, and add or remove it in place — never key or remount the group to change its shape, or the panes inside lose their DOM and state.",
		},
		{
			id: "RSZ-3",
			text: "Sizes are percentages of the group. Set `defaultSize` for the panel set, constraints with `minSize` / `maxSize`, and move a mounted layout with `ref` (`setLayout`, `collapse`, `expand`), not by changing `defaultSize`.",
		},
		{
			id: "RSZ-4",
			text: "Commit a resize once: from `onDragging(false)` for a pointer and from key up for the keyboard. `onLayout` fires on every move and is for projection only.",
		},
		{
			id: "RSZ-5",
			text: "Collapse to `collapsedSize={0}` and hide the collapsed pane completely: `inert` / `aria-hidden` on its content, `hidden`, `tabIndex={-1}` and `aria-hidden` on its handle.",
		},
		{
			id: "RSZ-6",
			text: "Keep the handle as it is: no grip, no colour, width or hit-area overrides. The default `hitAreaMargins` keeps the preceding panel's scrollbar usable.",
		},
		{
			id: "RSZ-7",
			text: "Panels carry no surface: the child sets the region's background and its own scrolling (QuietScrollArea), and the group's parent gives it a height (`h-full`, or `min-h-0 flex-1`).",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Side pane and content",
			description: "Two panels with a minimum each and one handle between them.",
		},
		{
			id: "collapsible-pane",
			title: "Collapsible pane",
			description:
				"Project Home's Projects pane: a pressed toggle collapses and expands it through `ImperativePanelHandle`; while collapsed the pane is `inert` and its handle is hidden.",
		},
		{
			id: "vertical-stack",
			title: "Vertical stack",
			description:
				'Two groups stacked in one side region; `direction="vertical"` on the group and the handle.',
		},
		{
			id: "three-columns",
			title: "Three columns",
			description:
				"The workbench columns: collapsible sides around a center with its own minimum, each panel with `id` and `order`.",
		},
		{
			id: "nested",
			title: "Nested groups",
			description:
				"A vertical group holding the main row (itself a horizontal group) and a bottom panel capped with `maxSize`.",
		},
		{
			id: "conditional-panel",
			title: "Showing and hiding a panel",
			description:
				"The bottom panel is added and removed in place with a stable `id` and `order`; the main row keeps its DOM.",
		},
		{
			id: "disabled-handle",
			title: "Disabled handle",
			description:
				"A center split whose handle is `disabled`, as the workbench does while the group is narrower than two minimum widths.",
		},
		{
			id: "layout-events",
			title: "Committing a resize",
			description:
				"`onLayout` tracks every move; the sizes shown update only on release (`onDragging(false)`) or key up.",
		},
		{
			id: "reset-layout",
			title: "Resetting the layout",
			description: "`setLayout` on the group's `ref` restores the default sizes.",
		},
		{
			id: "remember-layout",
			title: "Remembered layout",
			description: "`autoSaveId` keeps the split in `localStorage`: resize it and reload the page.",
		},
	],
	usages: [
		{
			file: "apps/web/src/shell/ProjectHome.tsx",
			note: "Projects beside Welcome: `autoSaveId`, a collapsible pane driven by `ImperativePanelHandle`, the handle hidden while collapsed.",
		},
		{
			file: "apps/web/src/shell/layout/Workbench.tsx",
			note: "Outer columns, the aligned row and the bottom column: nested groups, conditional panels with `id` / `order`, `maxSize`, committed sizes through `ref`.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchCenter.tsx",
			note: "A center split in either direction, with the handle `disabled` while the group is too small.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchSide.tsx",
			note: "A side region's vertical stack of groups (handles via `PanelWithHandle` in `workbenchShared.tsx`).",
		},
		{
			file: "apps/web/src/shell/layout/workbenchBottom.tsx",
			note: "The bottom region's groups side by side.",
		},
	],
} satisfies ComponentDoc;
