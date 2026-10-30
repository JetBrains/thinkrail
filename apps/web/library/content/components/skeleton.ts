import type { LoadingRegion, SkeletonRows } from "@thinkrail/ui/skeleton";
import type { ComponentDoc, PropDoc } from "../types";

type LoadingRegionProps = Parameters<typeof LoadingRegion>[0];
type SkeletonRowsProps = Parameters<typeof SkeletonRows>[0];

const rowsDoc = {
	type: "number",
	default: "6",
	description:
		"How many bars to draw, clamped to 12 (the length of the fixed width sequence). Approximate the content that will arrive: 2 for a short sub-list, 3–5 for a menu section, settings list or panel list, 8–12 for a tab body or a full pane.",
} as const satisfies PropDoc;

const labelDoc = {
	type: "string",
	default: 't("components.skeleton.loading")',
	description:
		'The status region\'s `aria-label`. Pass a specific locale key when it tells the reader more than "Loading" — `shell.workbench.restoring.chat`, `panels.existingWorktree.loading`, `mcp.settings.loading`.',
} as const satisfies PropDoc;

export const skeleton = {
	slug: "skeleton",
	name: "LoadingRegion and SkeletonRows",
	group: "Feedback",
	source: "packages/ui/skeleton.tsx",
	preview: "preview",
	tag: "<LoadingRegion",
	importLine: 'import { LoadingRegion, SkeletonRows } from "@thinkrail/ui/skeleton";',
	summary:
		'The one loading placeholder for a content region. `SkeletonRows` draws pulsing bars of varied widths inside a single labelled `role="status"` region that stays invisible through a short grace and then fades in; `LoadingRegion` wraps it in a plain `div` that takes the region\'s padding, size and test id. They own the bars, their rhythm and motion and the live-region semantics; the call site picks the row count, the frame and, when it helps, a specific label. Which loading tier a surface takes is the [Loading](#/loading) pattern.',
	whenToUse: [
		"A region that will fill with substantial content is waiting for its first read: a tool panel's list (Files, Specs, Changes, Review), a dialog's list, a menu's list section, a settings section.",
		"A tab body or lazy chunk is restoring: the workbench's `MissingResource` and the pane-level `Suspense` fallbacks.",
		"Reach for `LoadingRegion` whenever the placeholder needs padding, a height or a test id; use `SkeletonRows` alone only inside a container that already frames it.",
	],
	alternatives: [
		{
			name: "Button",
			when: "An in-flight action pinned to its control: `loading` swaps in the spinner, `loading spinIcon` rotates a refresh icon while the content stays valid.",
		},
		{
			name: "RunningIcon",
			when: "An agent session is running; that is activity, not data on the way.",
		},
		{
			name: "SettingsNotice",
			when: "The read failed: replace the skeleton with the error and its Retry action, never show both at once.",
		},
		{
			name: "Nothing",
			when: "The content may legitimately never appear and absence is a valid steady state (see [Loading](#/loading)).",
		},
	],
	anatomy: [
		{
			part: "Region",
			description:
				"`LoadingRegion` only: a plain `div` with the call site's `className` and `data-testid={testId}`. It has no look of its own and never opens a second live region.",
		},
		{
			part: "Status region",
			description:
				'The `SkeletonRows` root: a `div` with `role="status"`, `aria-label`, `aria-busy="true"` and `data-testid="skeleton-rows"`; a vertical `flex` column with `gap-8` that carries `animate-loading-in`.',
		},
		{
			part: "Bars",
			description:
				"One empty `span` per row from a fixed width sequence (`w-3/4`, `w-1/2`, `w-5/6`, …), so every skeleton has the same ragged shape: `h-3`, `rounded-sm`, `bg-control-bg-hovered`, `animate-pulse`. Widths are fractions of the parent, so the parent sets the width.",
		},
	],
	props: {
		rows: rowsDoc,
		label: {
			...labelDoc,
			description: `${labelDoc.description} Threaded through to \`SkeletonRows\`; an empty string falls back to the default.`,
		},
		className: {
			type: "string",
			description:
				"The region's own padding and size, matching the content that replaces it (`px-8 py-4` in side panels, `p-12` in panes, `h-full p-12` for a pane fallback, `min-h-112 p-4` in a dialog list).",
		},
		testId: {
			type: "string",
			description:
				"`data-testid` on the region (`file-pane-loading`, `existing-worktree-loading`). The inner `skeleton-rows` id is shared by every instance.",
		},
	} satisfies Record<keyof LoadingRegionProps, PropDoc>,
	nativeProps: {
		title: "SkeletonRows props",
		props: {
			rows: rowsDoc,
			label: labelDoc,
		} satisfies Record<keyof SkeletonRowsProps, PropDoc>,
	},
	states: [
		{
			state: "Grace",
			how: "Mount (the parent's data is still `null`).",
			appearance:
				"In the layout at full size but transparent through the `animate-loading-in` delay, so a read that lands quickly never flashes bars. The status region and test ids exist from the first paint.",
		},
		{
			state: "Loading",
			how: "Still mounted after the grace.",
			appearance: "Fades to full opacity; the bars pulse on `bg-control-bg-hovered`.",
		},
		{
			state: "Resolved",
			how: "The call site renders its content instead.",
			appearance:
				"The skeleton unmounts; the content's own root fades in with `motion-safe:animate-reveal` where the [Loading](#/loading) pattern allows it.",
		},
		{
			state: "Failed",
			how: "The read rejects.",
			appearance:
				"No treatment of its own: the call site replaces the skeleton with its error and Retry.",
		},
		{
			state: "Reduced motion",
			how: "`prefers-reduced-motion: reduce`.",
			appearance: "No distinct treatment; the grace fade and the pulse still run.",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance: "No distinct treatment; the placeholder is not interactive.",
		},
	],
	accessibility: [
		'Exactly one `role="status"` region per placeholder, with `aria-busy="true"` and an `aria-label` (default `components.skeleton.loading`). `LoadingRegion` threads `label` to it instead of nesting a second region.',
		"The bars are empty spans with no text, so assistive technology hears only the label.",
		"Name what is loading when the context does not: restoring a chat tab, reading Git worktrees, loading commits or MCP servers.",
		"Not focusable. Inside a menu it is not a menu item, so arrow keys and typeahead skip it.",
	],
	keyboard: [
		{
			keys: "—",
			action:
				"No keyboard interaction; focus stays on the surrounding dialog, menu or panel while the region loads.",
		},
	],
	rules: [
		{
			id: "SKL-1",
			text: "Every content region waiting for data renders this placeholder — never bare “Loading…” text, never an empty frame, never a spinner centred in the region. The tier rules are the [Loading](#/loading) pattern.",
		},
		{
			id: "SKL-2",
			text: "Prefer `LoadingRegion` and give its `className` the padding and size of the content that replaces it, so the data lands without a layout jump. Use bare `SkeletonRows` only inside a container that already frames it.",
		},
		{
			id: "SKL-3",
			text: "Choose `rows` from the content's footprint: 2 for a short sub-list, 3–5 for a menu section, settings section or side-panel list, 8–12 for a tab body or full pane.",
		},
		{
			id: "SKL-4",
			text: 'Put a specific message on `label` from a locale key; never wrap the placeholder in your own `role="status"` or add visible loading text beside it.',
		},
		{
			id: "SKL-5",
			text: "Never restyle the bars or copy their classes into a hand-made skeleton. A hand-shaped placeholder is only for a footprint rows cannot represent, such as the Welcome panel's card grid.",
		},
		{
			id: "SKL-6",
			text: "Never show Retry beside an active skeleton: the error and its Retry replace it only after a real failure.",
		},
		{
			id: "SKL-7",
			text: "Put `motion-safe:animate-reveal` on the resolved content's own root — never on the skeleton or on a wrapper around both branches.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Preview",
			description: "A short list region with the default label.",
		},
		{
			id: "panel-list",
			title: "Side-panel list",
			description:
				"The Changes and Review panels: five rows with the panel's own `px-8 py-4` padding.",
		},
		{
			id: "load-then-reveal",
			title: "Expand, load, reveal",
			description:
				"Expanding a project in the Projects rail: two rows under it while its workspaces load, then the list fades in with `motion-safe:animate-reveal` on its own root. Collapse and expand to replay.",
		},
		{
			id: "restoring-tab",
			title: "Restoring tab body",
			description:
				"The workbench's `MissingResource`: twelve rows, a specific label and a full-height region that clips its bars.",
		},
		{
			id: "dialog-list",
			title: "Dialog list with retry after failure",
			description:
				"Open existing worktree: a labelled region with a minimum height and a test id; the error and Retry replace it only once the read fails.",
		},
		{
			id: "menu-section",
			title: "Menu section",
			description:
				"The Changes scope menu's commit section loads below its label; the commits arrive as plain menu items without a reveal.",
		},
		{
			id: "settings-section",
			title: "Settings section",
			description:
				"Settings sections use bare `SkeletonRows` inside their own container, optionally with a specific label.",
		},
	],
	usages: [
		{
			file: "apps/web/src/shell/WorkspaceWorkbench.tsx",
			note: "`MissingResource`: every restoring tab body and lazy-chunk fallback, 12 rows with a per-kind label.",
		},
		{
			file: "apps/web/src/panels/ChangesPanel.tsx",
			note: "The Changes list while the first status read is pending (`px-8 py-4`).",
		},
		{
			file: "apps/web/src/panels/ExistingWorktreeDialog.tsx",
			note: "The worktree-candidate list with a label and `testId`, replaced by the error and Retry on failure.",
		},
		{
			file: "apps/web/src/panels/ChangesScopeMenu.tsx",
			note: "The commit section of a dropdown menu, labelled `changes.scopeMenu.loadingCommits`.",
		},
		{
			file: "apps/web/src/panels/FileTree.tsx",
			note: "The file tree before its first listing (8 rows, `px-4 py-4`).",
		},
		{
			file: "packages/resource-renderers/src/support/ResourcePreview.tsx",
			note: "The shared pane fallback (`h-full p-12`) of the resource renderers.",
		},
	],
} satisfies ComponentDoc;
