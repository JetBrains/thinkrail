import type { ComponentProps } from "react";
import type { TreeRow } from "@/panels/TreeRow";
import type { ComponentDoc, PropDoc } from "../types";

type TreeRowProps = ComponentProps<typeof TreeRow>;

export const treeRow = {
	slug: "tree-row",
	name: "TreeRow",
	group: "Data display",
	source: "apps/web/src/panels/TreeRow.tsx",
	preview: "preview",
	tag: "<TreeRow",
	importLine: 'import { TreeRow } from "@/panels/TreeRow";',
	summary:
		"The file-style tree row shared by the Files tree and the Changes tree, so the two stay identical. It is one full-width button at `h-panel-row` with a chevron (folders) or a spacer (files), a folder or file icon, a truncated label and a trailing slot; it owns the geometry, the icons, the hover and selected fills and the focus ring. The call site provides the label, the kind, the open and active state, the label colour for git status, the trailing marks, the nesting (`pl-tree-indent` lists) and every handler.",
	whenToUse: [
		"A row of a file or folder hierarchy in a side panel: the workspace Files tree and the Changes tree view.",
		"Any new file-like tree that must look and behave exactly like those two — reuse TreeRow instead of drawing another row.",
		"A file row that needs a trailing status letter, change dot, `+N −M` badge or viewed mark.",
		'A row whose hover and selected fill must cover a wider wrapper with a row-actions menu (`highlight="wrapper"`).',
	],
	alternatives: [
		{
			name: "FileChip",
			when: "A file reference inline in chat or a composer, not a row in a hierarchy.",
		},
		{
			name: "Collapsible",
			when: "Folding one long block of tool output rather than a nested list.",
		},
		{
			name: "ContextMenu",
			when: "The row only needs a right-click menu; compose it around the row instead of extending TreeRow.",
		},
		{
			name: "Command",
			when: "Finding a file by name across the workspace; a tree is for browsing by structure.",
		},
	],
	anatomy: [
		{
			part: "Row",
			description:
				'A native `<button type="button">`, `flex h-panel-row w-full min-w-0 items-center gap-4 rounded-sm px-4`, `tr-text-ui`, with `data-testid`, `data-kind`, `data-active`, `data-status` and `data-viewed`. `min-w-0` lets it shrink beside a trailing control on the same flex line.',
		},
		{
			part: "Lead",
			description:
				"Folders: a `size-16` chevron, right when collapsed and down when `expanded`. Files: an empty `size-14` spacer.",
		},
		{
			part: "Icon",
			description:
				"`size-14` folder or file icon — the line icon, or the fill icon while `active`.",
		},
		{
			part: "Label",
			description:
				"`label`, one line, truncated with an ellipsis; `labelClassName` adds status colour or a line-through.",
		},
		{
			part: "Trailing slot",
			description:
				"`trailing`, rendered after the label inside the button: a status letter, a change dot, DiffStatBadge, the viewed mark.",
		},
		{
			part: "Nesting",
			description:
				'Not part of the row: call sites nest children in a `<ul className="flex flex-col pl-tree-indent">` under the folder\'s `<li>`.',
		},
	],
	props: {
		label: {
			type: "string",
			description:
				"Required. The file or folder name — or a slash-joined compact run (`apps/web/src`). Also the accessible name with the trailing text.",
		},
		kind: {
			type: '"dir" | "file"',
			description:
				"Required. Folders get the chevron and folder icon; files a spacer and file icon.",
		},
		testid: {
			type: "string",
			description:
				'Required. Written to `data-testid` (`"file-node"`, `"change-item"`, `"change-tree-folder"`).',
		},
		expanded: {
			type: "boolean",
			description:
				"Folders only: chevron down when true, right otherwise. The call site renders the children.",
		},
		active: {
			type: "boolean",
			description:
				"The row's resource is the open one. Fill icon, `data-active`, and the selected fill when `highlight` is `self`.",
		},
		subtle: {
			type: "boolean",
			default: "false",
			description:
				"Dims the label and icons from `text-text-muted` to `text-text-subtle` — gitignored entries.",
		},
		labelClassName: {
			type: "string",
			description:
				"Classes for the label span only: git status colour from `statusNameClass` / `statusMarkClass`, `opacity-60` for a viewed file. Never geometry.",
		},
		trailing: {
			type: "ReactNode",
			description:
				"Marks after the label, inside the button: give them `shrink-0` so the label truncates first.",
		},
		highlight: {
			type: '"self" | "wrapper"',
			default: '"self"',
			description:
				"`self`: the row paints its own hover and selected fill. `wrapper`: it paints none, so a surrounding element (ChangeRowActions) can paint one fill across the row and its menu button.",
		},
		dataStatus: {
			type: "string",
			description:
				'Written to `data-status` (git status, or `"ignored"`) for tests and styling hooks.',
		},
		dataViewed: {
			type: "boolean",
			description: "Sets `data-viewed` when true — a change marked viewed.",
		},
		onClick: {
			type: "(event: MouseEvent) => void",
			description:
				"Activation. Folders toggle; files open as preview, wrapped in `firstClickOnly` so a double click's second click does nothing.",
		},
		onDoubleClick: {
			type: "() => void",
			description: "Files: keep the preview tab (open it permanently).",
		},
		onContextMenu: {
			type: "(event: MouseEvent) => void",
			description: "Right-click or the context-menu key — ChangeRowActions opens its menu here.",
		},
		onWarm: {
			type: '(trigger: "hover" | "focus") => void',
			description:
				"Called on pointer enter (`hover`) and focus (`focus`) so a file's editor can preload. FileTree warms at once on focus and through `warmOnHover` on hover.",
		},
		ref: {
			type: "Ref<HTMLButtonElement>",
			description:
				"Forwarded to the `<button>` — FileTree scrolls a revealed file into view with it.",
		},
	} satisfies Record<keyof TreeRowProps, PropDoc>,
	sections: [
		{
			id: "states",
			title: "States",
			description:
				'Every cell is the real component. Hover a cell or click into the page and press Tab to see the hover fill and the inset focus ring. With `highlight="wrapper"` the row paints no fill of its own — only the fill icon marks it active.',
		},
	],
	states: [
		{
			state: "Default",
			how: "Rest.",
			appearance: "No fill; label and icons `text-text-muted`.",
		},
		{
			state: "Hover",
			how: 'Pointer over the row, `highlight="self"`.',
			appearance:
				"`control-bg-hovered` fill. With `wrapper` the row paints nothing; the wrapper does.",
		},
		{
			state: "Keyboard focus",
			how: "Tab to the row.",
			appearance: "A 2px inset `primary` ring (`focus-visible:ring-2 ring-inset`); no outline.",
		},
		{
			state: "Active",
			how: "`active`.",
			appearance:
				'Fill icon, `data-active`, and the `control-bg-selected` fill with `highlight="self"` (the wrapper paints it otherwise).',
		},
		{
			state: "Expanded / collapsed",
			how: "`expanded` on a folder.",
			appearance:
				"Chevron down or right. Nothing else changes; the call site shows or hides the children.",
		},
		{
			state: "Subtle",
			how: "`subtle`.",
			appearance: "Label and icons `text-text-subtle` (gitignored).",
		},
		{
			state: "Git status",
			how: "`labelClassName` from `statusNameClass` / `statusMarkClass`.",
			appearance:
				"Added and untracked green, deleted red with a line-through, renamed blue, modified plain on the name (Changes) or warning-coloured (Files).",
		},
		{
			state: "Disabled, loading, empty",
			how: "—",
			appearance:
				"No distinct treatment. The tree shows LoadingRegion while loading and an empty message instead of rows.",
		},
	],
	accessibility: [
		'Each row is a native `<button type="button">`; its accessible name is the label plus any trailing text. The icons have no label.',
		'The trees are plain nested `<ul>` / `<li>` lists, not an ARIA `tree`: rows carry no `role="treeitem"`, `aria-expanded`, `aria-level` or `aria-selected`, so folder state and the active file are visual only.',
		"Every row is a separate Tab stop; there is no roving focus or arrow-key navigation.",
		"Focus shows the inset `primary` ring, so it is not clipped by the panel's scroll container.",
		"A double click (keep) has no keyboard equivalent on the row; activating an already-active preview keeps it, and the strip offers a Keep Preview command.",
		'`trailing` marks that carry meaning need their own name — ViewedMark has `role="img"` and a label; a coloured dot or name colour alone is not announced.',
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves focus row by row; the focus ring appears." },
		{
			keys: "Enter / Space",
			action: "Activates: toggles a folder, opens a file as preview.",
		},
		{
			keys: "Shift+F10 / Context menu key",
			action: "Fires `onContextMenu` — opens the row-actions menu in the Changes tree.",
		},
	],
	rules: [
		{
			id: "TRW-1",
			text: "Every file or folder row in a side-panel tree is a TreeRow, so the Files and Changes trees stay identical — never a hand-drawn row or a menu item restyled as one.",
		},
		{
			id: "TRW-2",
			text: 'Nest with `<ul className="flex flex-col pl-tree-indent">` inside the folder\'s `<li>`; never indent with padding on the row.',
		},
		{
			id: "TRW-3",
			text: "Show git status on the name through `labelClassName` from `changesModel` (`statusNameClass`, `statusMarkClass`); never invent another status colour.",
		},
		{
			id: "TRW-4",
			text: "Put marks in `trailing` with `shrink-0` so the label truncates first; a folder shows an aggregate DiffStatBadge only while collapsed.",
		},
		{
			id: "TRW-5",
			text: "Open files as preview on click with `firstClickOnly`, keep on double click; folders toggle on click.",
		},
		{
			id: "TRW-6",
			text: 'Use `highlight="wrapper"` only when a wrapper paints the hover and selected fill for the row and its actions (ChangeRowActions); otherwise leave the default.',
		},
		{
			id: "TRW-7",
			text: "Compact a run of single-child folders into one slash-joined `label`; the row expands and collapses the deepest folder.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "File tree",
			description: "A folder with its files nested under `pl-tree-indent`; one file is active.",
		},
		{
			id: "files-tree",
			title: "Files panel",
			description:
				"A working tree: folders toggle, a click opens a file, gitignored entries are subtle and changed files show a status letter and their folder a dot.",
		},
		{
			id: "changes-tree",
			title: "Changes tree",
			description:
				"Status on the name, a `+N −M` badge per file, and a folder's aggregate badge only while it is collapsed.",
		},
		{
			id: "row-actions",
			title: "Row actions",
			description:
				'`highlight="wrapper"` inside ChangeRowActions: one fill covers the row and its menu; right-click opens the same menu.',
		},
		{
			id: "states",
			title: "Kind and state",
			description: "Folder collapsed and expanded, file, active file and a gitignored entry.",
		},
		{
			id: "status-names",
			title: "Status on the name",
			description:
				"`statusNameClass` for each git status, and a viewed change dimmed with the viewed mark.",
		},
		{
			id: "compact-folders",
			title: "Compact folders and long names",
			description:
				"A single-child folder run is one slash-joined row; long names truncate before the trailing marks.",
		},
		{
			id: "open-gestures",
			title: "Preview, keep and warm",
			description:
				"A click opens a preview, a double click keeps it, and hover or focus reports a warm-up.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/FileTree.tsx",
			note: "Workspace Files tree: compact folders, gitignored `subtle` rows, status letters, editor warm-up and reveal via `ref`.",
		},
		{
			file: "apps/web/src/panels/ChangesTree.tsx",
			note: 'Changes tree: status-coloured names, DiffStatBadge, viewed marks and `highlight="wrapper"` inside ChangeRowActions.',
		},
	],
} satisfies ComponentDoc;
