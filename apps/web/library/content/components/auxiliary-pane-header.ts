import type { ComponentProps, HTMLAttributes } from "react";
import type {
	AuxiliaryPaneHeader,
	AuxiliaryPaneHideButton,
} from "@/shell/layout/AuxiliaryPaneHeader";
import type { ComponentDoc, PropDoc } from "../types";

type HeaderProps = ComponentProps<typeof AuxiliaryPaneHeader>;
type HeaderOwnProps =
	| "title"
	| Exclude<keyof HeaderProps, keyof HTMLAttributes<HTMLDivElement> | "key">;
type HideProps = Parameters<typeof AuxiliaryPaneHideButton>[0];

export const auxiliaryPaneHeader = {
	slug: "auxiliary-pane-header",
	name: "AuxiliaryPaneHeader",
	group: "Layout",
	source: "apps/web/src/shell/layout/AuxiliaryPaneHeader.tsx",
	preview: "preview",
	tag: "<AuxiliaryPaneHeader",
	importLine:
		'import { AuxiliaryPaneHeader, AuxiliaryPaneHideButton } from "@/shell/layout/AuxiliaryPaneHeader";',
	summary:
		"The plain header of an auxiliary (edge) pane: a fixed-height row with the pane's title and its trailing actions, and `AuxiliaryPaneHideButton`, the pane's Hide control. It owns the height, surface, border and title type, and — given `dragTab` — turns the title into a drag handle for that tool. The call site provides the title, the actions and the region the Hide button controls.",
	whenToUse: [
		"An auxiliary pane whose selected tab is a singleton tool (Projects, Specs, Files, Review, TODO List): the tool's name as the title, draggable with `dragTab`.",
		"An empty auxiliary pane: *Tools* on a side, *Terminal* at the bottom, with the add menu and Remove group.",
		"Project Home's Projects pane, composed around its own geometry without drag data, so the tool looks the same with or without the workbench.",
		"`AuxiliaryPaneHideButton` as the last action of every expanded auxiliary pane — including a terminal pane's TabStrip.",
	],
	alternatives: [
		{
			name: "TabStrip",
			when: "The pane's selected tab is a terminal: it shows the pane's named session tabs instead of a title.",
		},
		{
			name: "HeaderIconButton",
			when: "A toggle in a feature panel's own header, inside the pane body.",
		},
		{
			name: "Collapsible",
			when: "Folding a block of content inside a panel, not hiding a whole edge pane.",
		},
	],
	anatomy: [
		{
			part: "Header",
			description:
				"A `h-panel-header-row` row on `container-header-bg` with a `border-muted` bottom border; spreads the rest of its props onto the `<div>`.",
		},
		{
			part: "Title",
			description:
				"A `tr-title-compact` span in `text-default` with `px-12` that takes the free width. It is itself a flex box, so its `truncate` draws no ellipsis: a long title is cut off where the actions begin.",
		},
		{
			part: "Drag handle",
			description:
				"With `dragTab`, the title becomes a dnd-kit draggable carrying `{ tab }` — the same drag data as the tool's rail entry — with a grab cursor.",
		},
		{ part: "Actions", description: "`actions`, after the title." },
		{
			part: "Hide button",
			description:
				"`AuxiliaryPaneHideButton`: IconButton `ghost` `m` with a close icon, named *Hide pane*, `shrink-0 self-center`.",
		},
	],
	props: {
		title: {
			type: "string",
			description:
				"The pane's name: the selected tool's `layoutTabName`, or `workbench.pane.tools` / `workbench.rail.terminal` for an empty pane. Replaces the native `title` attribute.",
		},
		dragTab: {
			type: "LayoutTab",
			description:
				"Makes the title a drag handle for this tab. Pass the selected tool inside the workbench's `DndContext`; omit it outside the workbench.",
		},
		actions: {
			type: "ReactNode",
			description:
				"Trailing actions — IconButton `ghost` `m` with `shrink-0 self-center`: the add menu, Remove group on an empty pane, then the Hide button.",
		},
		ref: {
			type: "Ref<HTMLDivElement>",
			description:
				"Forwarded to the header `<div>`; the workbench attaches its join droppable here.",
		},
		className: {
			type: "string",
			description:
				"Merged after the base classes. The workbench passes its drop-hint and drop-active fills here, keyed on the `data-drop-*` attributes it sets; otherwise placement only.",
		},
	} satisfies Record<HeaderOwnProps | "className", PropDoc>,
	nativeProps: {
		title: "AuxiliaryPaneHideButton props",
		props: {
			controls: {
				type: "string",
				description: "`aria-controls`: the id of the pane region it hides.",
			},
			testId: {
				type: "string",
				description:
					"`data-testid`: `side-group-fold` on a side, `bottom-group-fold` at the bottom (e2e tests rely on it).",
			},
			onClick: { type: "() => void", description: "Hides or folds the pane." },
		} satisfies Record<keyof HideProps, PropDoc>,
	},
	states: [
		{
			state: "Default",
			how: "Rest.",
			appearance: "Header surface, muted bottom border, the title in default text.",
		},
		{
			state: "Drag handle hover",
			how: "Pointer over a title with `dragTab`.",
			appearance: "Grab cursor; no fill.",
		},
		{
			state: "Dragging",
			how: "Drag the title in a `DndContext`.",
			appearance: "Grabbing cursor (`data-dragging`); the header itself does not move.",
		},
		{
			state: "Drop hint / drop active",
			how: "A tool drag that can join this pane (workbench only).",
			appearance:
				"No treatment of its own: the workbench sets `data-drop-hint` / `data-drop-active` and passes `primary-subtle` / `primary-soft` fills through `className`.",
		},
		{
			state: "Long title",
			how: "A narrow pane.",
			appearance: "The title is clipped at the actions with no ellipsis; actions keep their size.",
		},
		{
			state: "Hide button",
			how: "Hover, press, Tab.",
			appearance: "IconButton `ghost` states and the *Hide pane* tooltip.",
		},
		{
			state: "Disabled / selected",
			how: "—",
			appearance: "No distinct treatment.",
		},
	],
	accessibility: [
		"The header is a plain `<div>` and its title a `<span>`, not a heading: name the pane on its region (`<section aria-label>`), as Project Home and the workbench tool body do.",
		"The drag handle receives only pointer listeners — it is not focusable and has no role. Keyboard users arrange tools from the rail entry's menu instead.",
		'`AuxiliaryPaneHideButton` is named *Hide pane*, sets `aria-controls` to the pane and `aria-expanded="true"` (it renders only while the pane is open).',
		"After hiding, the pane's rail entry stays the way back; the workbench moves focus there.",
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves between the actions; the title is skipped." },
		{ keys: "Enter / Space", action: "Activates the focused action; on Hide, hides the pane." },
	],
	rules: [
		{
			id: "APH-1",
			text: "Use AuxiliaryPaneHeader when the pane's selected tab is a tool or nothing; when it is a terminal, render the pane's TabStrip of sessions instead.",
		},
		{
			id: "APH-2",
			text: "The title is the pane's name from `layoutTabName` or the empty-pane locale key — never a custom label, heading or extra content.",
		},
		{
			id: "APH-3",
			text: "Pass `dragTab` only for a placed tool inside the workbench's `DndContext`; Project Home and other frame-less surfaces compose the header without it.",
		},
		{
			id: "APH-4",
			text: "Every expanded auxiliary pane ends with `AuxiliaryPaneHideButton`, last in `actions`, with `controls` set to the pane's region id.",
		},
		{
			id: "APH-5",
			text: "Actions are IconButton `ghost` `m` with `shrink-0 self-center`, shown only when they can act — Remove group only on an empty pane.",
		},
		{
			id: "APH-6",
			text: "Do not restyle the header: no height, surface, border or type classes. It is the one owner of edge-pane header styling, shared by the workbench and Project Home.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Preview",
			description: "A pane title with the Hide button.",
		},
		{
			id: "project-home",
			title: "Project Home",
			description: "The rail entry and the Hide button toggle the same pane, as on Project Home.",
		},
		{
			id: "tool-pane",
			title: "Tool pane",
			description:
				"The selected tool's name as a drag handle (`dragTab`), the pane's add menu and Hide.",
		},
		{
			id: "pane-stack",
			title: "Pane stack",
			description:
				"Two right panes: a tool pane and an empty *Tools* pane whose Remove group commits `removeLayoutGroup`.",
		},
		{
			id: "bottom-empty",
			title: "Empty bottom pane",
			description: "An empty bottom pane titled *Terminal*, with its add menu and Hide.",
		},
		{
			id: "long-title",
			title: "Long title",
			description:
				"In a narrow pane the actions keep their size and the title is cut off — without an ellipsis, because the title span is a flex box.",
		},
	],
	usages: [
		{
			file: "apps/web/src/shell/layout/workbenchSide.tsx",
			note: "`AuxiliaryGroupHeader`: tool and empty panes with `dragTab`, the add menu, Remove group, Hide and the join drop cues.",
		},
		{
			file: "apps/web/src/shell/ProjectHome.tsx",
			note: "The Projects pane header without drag data, with the Hide button beside the rail entry.",
		},
	],
} satisfies ComponentDoc;
