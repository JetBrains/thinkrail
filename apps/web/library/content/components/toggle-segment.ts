import type { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import type { ComponentProps } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type OwnProps = keyof ComponentProps<typeof ToggleSegment>;

export const toggleSegment = {
	slug: "toggle-segment",
	name: "ToggleSegment",
	group: "Data entry",
	source: "packages/ui/toggle-segment.tsx",
	preview: "list-tree",
	tag: "<ToggleSegment",
	importLine: 'import { ToggleSegment } from "@thinkrail/ui/toggle-segment";',
	summary:
		"One slim text segment of a view toggle in a header or toolbar strip — List | Tree, Split | Inline, Preview | Source. It renders a single `<button>` with `aria-pressed` and owns its type, padding and the active fill (`control-bg-selected`, the same selected role as tabs). The call site renders one segment per option, decides which one is `active`, and provides the row, the gap and any group label.",
	whenToUse: [
		"Switching how a panel or pane shows the same content: List | Tree, All | Changed, Split | Inline, Stacked | One file.",
		"Choosing among resolved renderer candidates (Preview | Source, Image | File) in a pane header.",
		"Choosing a preview mode beside the content it controls, such as the HTML preview width or the visual-diff mode.",
		"Any place a few short, mutually exclusive view options sit inline in chrome next to other header controls.",
	],
	alternatives: [
		{
			name: "SegmentedControl",
			when: "The choice is a setting or a form value (a radio group with one Tab stop and arrow keys), not a view toggle in chrome.",
		},
		{
			name: "HeaderIconButton",
			when: "A single on/off header toggle with a familiar icon (hide whitespace, show the review guide).",
		},
		{
			name: "TabStrip",
			when: "The options switch between different documents or panels with their own tabpanels.",
		},
		{
			name: "DropdownMenu",
			when: "There are too many options to show inline, or the labels are long.",
		},
	],
	anatomy: [
		{
			part: "Segment",
			description:
				'A native `<button type="button">` with `aria-pressed`, `data-active` and `data-testid`; `tr-text-metadata` type, compact horizontal padding and a small radius.',
		},
		{
			part: "Label",
			description: "The `label` string as the button's only content; there is no icon slot.",
		},
		{
			part: "Active fill",
			description: "`control-bg-selected` with `text-default` on the active segment.",
		},
		{
			part: "Group (call site)",
			description:
				'The component renders no group. The call site places segments in a flex row with a small gap, inside a `role="toolbar"` row or a `<fieldset aria-label>` when the set needs a name.',
		},
	],
	props: {
		testid: {
			type: "string",
			description:
				"Required. Rendered as `data-testid` on the button; e2e tests select segments by it.",
		},
		label: {
			type: "string",
			description:
				"The visible text and the accessible name. Use a locale key; keep it to one or two short words.",
		},
		active: {
			type: "boolean",
			description:
				"Required. Whether this segment is the current view. Sets `aria-pressed` and `data-active` and paints the active fill. The call site keeps exactly one segment of a set active.",
		},
		disabled: {
			type: "boolean",
			default: "false",
			description:
				"Natively disables the button. Only an inactive segment shows the disabled text colour; an active one keeps its active look.",
		},
		onClick: {
			type: "() => void",
			description:
				"Required. Called on every activation, including on the segment that is already active; set the view to this segment's value.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	states: [
		{
			state: "Inactive",
			how: "`active={false}`.",
			appearance: "No fill; `text-muted` label.",
		},
		{
			state: "Hover",
			how: "Pointer over an inactive segment.",
			appearance:
				"`control-bg-hovered` fill and `text-default` label. An active segment has no hover change.",
		},
		{
			state: "Pressed",
			how: "Pointer down or Space held.",
			appearance: "No distinct treatment.",
		},
		{
			state: "Active",
			how: "`active`.",
			appearance: '`control-bg-selected` fill with a `text-default` label; `aria-pressed="true"`.',
		},
		{
			state: "Keyboard focus",
			how: "Tab to the segment.",
			appearance:
				"No component focus treatment; the browser's default focus outline is what shows.",
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance:
				"Inactive: `control-disabled-text` label and no hover fill. Active: no distinct treatment — it looks like an enabled active segment.",
		},
	],
	accessibility: [
		'Each segment is a native `<button type="button">` with `aria-pressed`, so assistive technology announces it as a toggle button that is pressed or not pressed.',
		"The `label` is the accessible name; there is no `aria-label` prop and no tooltip.",
		'The component sets no group role. Name the set where the context does not: the Files and Changes rows are `role="toolbar"` with an `aria-label`, the HTML preview width is a `<fieldset aria-label>`.',
		"Exclusivity is not exposed: each segment is an independent toggle, so a reader hears several toggle buttons, one of them pressed.",
		"Disabled segments use the native `disabled` attribute and leave the Tab order.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action:
				'Moves to the next or previous segment; every enabled segment is its own Tab stop. A surrounding `role="toolbar"` adds no arrow-key movement.',
		},
		{ keys: "Enter / Space", action: "Activates the segment (calls `onClick`)." },
	],
	rules: [
		{
			id: "TGS-1",
			text: "Use ToggleSegment for view toggles in chrome — header rows, pane toolbars, renderer strips. A setting or a form value is a SegmentedControl, because it needs radio semantics and one Tab stop; the MCP server dialogs' transport, exposure and scope pairs are the remaining form use.",
		},
		{
			id: "TGS-2",
			text: "Render a set, never a lone segment: a few short options from one piece of state, with exactly one `active`. A single on/off toggle is a HeaderIconButton or a Button with `selected` and `aria-pressed`.",
		},
		{
			id: "TGS-3",
			text: "Place segments in a flex row with a small gap (`gap-2` or `gap-4`) and add only placement. Never restyle the active segment or add a track behind the set; the selected look is `control-bg-selected`, shared with tabs.",
		},
		{
			id: "TGS-4",
			text: "Separate two independent sets in one row with space (`ml-auto`) or a thin vertical divider, as the review header does, so they never read as one choice.",
		},
		{
			id: "TGS-5",
			text: 'Name the set when its labels do not explain it: wrap the segments in a `<fieldset>` with an `aria-label` from a locale key, as the HTML preview width does. A `role="toolbar"` row names the set too, but it adds no arrow-key movement.',
		},
		{
			id: "TGS-6",
			text: "Labels come from locale keys and stay short; a count belongs in the label through its key (`panels.files.changedCount`), not in a badge beside it.",
		},
		{
			id: "TGS-7",
			text: "Give every segment a stable `testid` built from the set and the option (`changes-toggle-list`, `html-viewport-phone`).",
		},
	],
	examples: [
		{
			id: "list-tree",
			title: "List | Tree",
			description: "The Changes panel's view toggle in a named toolbar row.",
		},
		{
			id: "files-mode",
			title: "Count in the label",
			description:
				"The Files panel's All | Changed pair; the count comes from the label's locale key, and a header action sits at the end of the row.",
		},
		{
			id: "two-sets",
			title: "Two sets in one header",
			description: "Split | Inline and Stacked | One file, separated by a thin divider.",
		},
		{
			id: "renderer-candidates",
			title: "Renderer candidates",
			description:
				"One segment per resolved renderer, mapped from a list, then the diff layout pair.",
		},
		{
			id: "named-set",
			title: "Named set",
			description: "The HTML preview width as a `<fieldset>` with an `aria-label`.",
		},
		{
			id: "mode-and-side",
			title: "Mode and side",
			description:
				"The visual-diff header: the comparison mode on the left, the comment side pushed to the right.",
		},
		{
			id: "disabled",
			title: "Disabled option",
			description:
				"The MCP add dialog's scope pair: Project stays visible but disabled until the project is trusted, with the reason below.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ChangesPanel.tsx",
			note: "List | Tree at the end of the Changes toolbar row.",
		},
		{
			file: "apps/web/src/panels/FilesPanel.tsx",
			note: "All | Changed (with the changed-file count) in the Files toolbar row.",
		},
		{
			file: "apps/web/src/panels/ChangesReviewPane.tsx",
			note: "Split | Inline and Stacked | One file in the review header, split by a divider.",
		},
		{
			file: "packages/resource-renderers/src/support/RendererToggles.tsx",
			note: "Renderer candidates and the diff Split | Inline pair in file and diff pane headers.",
		},
		{
			file: "packages/resource-renderers/src/renderers/html/ViewportSwitch.tsx",
			note: "Preview width inside a labelled `<fieldset>`.",
		},
		{
			file: "packages/resource-renderers/src/renderers/VisualDiff.tsx",
			note: "Comparison mode and comment side in the visual-diff header.",
		},
	],
} satisfies ComponentDoc;
