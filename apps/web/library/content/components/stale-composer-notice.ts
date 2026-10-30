import type { StaleComposerNotice } from "../../../../../packages/resource-renderers/src/renderers/StaleComposerNotice";
import type { ComponentDoc, PropDoc } from "../types";

type StaleComposerNoticeProps = Parameters<typeof StaleComposerNotice>[0];

export const staleComposerNotice = {
	slug: "stale-composer-notice",
	name: "StaleComposerNotice",
	group: "Feedback",
	source: "packages/resource-renderers/src/renderers/StaleComposerNotice.tsx",
	preview: "preview",
	tag: "<StaleComposerNotice",
	importLine: 'import { StaleComposerNotice } from "../StaleComposerNotice";',
	summary:
		"A one-line warning that a review comment composer was closed because the file changed under its selection. It renders a `role=\"status\"` paragraph with a warning icon and the fixed `viewer.composer.fileChanged` message, or nothing while `visible` is false. It owns its look and its words; the renderer keeps it mounted in the composer's slot and passes the composer state's `stale` flag. It is internal to `packages/resource-renderers/src/renderers` and not exported from `@thinkrail/resource-renderers`, so renderers import it by relative path.",
	whenToUse: [
		"A renderer with a review composer (select content, then comment) whose content can change on disk while the composer is open.",
		"Explaining why an open composer disappeared after a re-read, and what to do next: select again.",
		"Every bundled surface that hash-stamps its composer with `useStampedComposer`: Pierre diffs, JSON and CSV views and diffs, notebook views and diffs, and the region review surface.",
	],
	alternatives: [
		{
			name: "SettingsNotice",
			when: "An inline message in settings or a dialog, with its own severity, text and an optional action.",
		},
		{
			name: "Toast",
			when: "A transient app-level message that is not tied to one renderer's composer slot.",
		},
		{
			name: "Refresh-failed notice",
			when: "A re-read failed and the preview shows the last loaded version: `ResourcePreview`'s `resource-preview-stale` bar, not this notice.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description:
				'A `<p role="status" data-testid="review-selection-stale">`: one `flex items-center gap-8` row on the notice surface — `bg-container-elevated-bg`, a `border-feedback-warning-muted` border, `rounded-sm` — at the dense `px-8 py-4` notice padding.',
		},
		{
			part: "Icon",
			description:
				"`RiAlertLine` (the warning glyph) at `size-14` in `text-feedback-warning`, `shrink-0` and `aria-hidden`.",
		},
		{
			part: "Message",
			description:
				"`viewer.composer.fileChanged` in `tr-text-metadata text-text-default`. Fixed: there is no prop for other text and no action.",
		},
	],
	props: {
		visible: {
			type: "boolean",
			description:
				"Required. Renders the notice when `true` and nothing when `false`. Pass the composer state's `stale` (`composer.stale`, `pending.stale` in the Pierre diff).",
		},
	} satisfies Record<keyof StaleComposerNoticeProps, PropDoc>,
	states: [
		{
			state: "Hidden",
			how: "`visible={false}` — no composer was open when the content changed, or the reader has selected again.",
			appearance: "Renders nothing; the slot takes no space.",
		},
		{
			state: "Visible",
			how: "`visible` — the content's stamp changed while a composer was open, so the selection and composer were dropped.",
			appearance:
				"The warning notice in the composer's slot, until the reader makes a new selection, which clears `stale`.",
		},
		{
			state: "Narrow",
			how: "A column narrower than the message.",
			appearance: "The message wraps; the icon stays vertically centred on the text block.",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance: "No distinct treatment; the notice is not interactive.",
		},
	],
	accessibility: [
		'`role="status"` makes the message a polite live region. The element is inserted when it becomes visible, rather than updating a region that already exists.',
		"The icon is `aria-hidden`; the message text is the whole content.",
		"Not focusable and never takes focus; focus is not moved when the composer it replaces unmounts.",
	],
	keyboard: [
		{
			keys: "—",
			action: "No keyboard interaction. The reader selects again with the renderer's own controls.",
		},
	],
	rules: [
		{
			id: "STN-1",
			text: "Use it only for a review composer whose selection went stale because the content changed. A failed re-read is the preview's refresh-failed notice; any other warning is a SettingsNotice or a Toast.",
		},
		{
			id: "STN-2",
			text: "Keep it mounted and drive `visible` from the composer state's `stale` (`useStampedComposer`); never compute staleness at the call site or wrap it in your own condition.",
		},
		{
			id: "STN-3",
			text: "Place it in the composer's slot — after the reviewed content and before the composer and the thread list, at the end of a notebook's cells, or first inside a scrolling Pierre diff — so it appears where the composer was.",
		},
		{
			id: "STN-4",
			text: "It carries one fixed message and no action. Do not add Retry, Dismiss or custom text; selecting again clears it.",
		},
		{
			id: "STN-5",
			text: "Do not restyle it or copy its classes. It follows the dense notice surface of [Notices](#/notices): neutral fill, warning border and the warning icon.",
		},
		{
			id: "STN-6",
			text: "It belongs to the renderers package: import it by relative path inside `packages/resource-renderers/src/renderers`. App code does not render it.",
		},
	],
	examples: [
		{ id: "preview", title: "Preview", description: "The visible notice." },
		{
			id: "file-changed",
			title: "File changed under the composer",
			description:
				"Comment on a line, then wait: the file changes on disk, the composer closes and the notice takes its place until you comment again.",
		},
		{
			id: "composer-slot",
			title: "In the composer slot",
			description:
				"JSON, CSV and region surfaces render it right after the reviewed content, where the composer opens, and before any thread cards.",
		},
		{
			id: "diff-top",
			title: "Top of a scrolling diff",
			description:
				"The Pierre diff renders it as the first child of its scroller, so it sits above the hunks and scrolls with them.",
		},
		{
			id: "notebook-end",
			title: "End of a notebook",
			description: "Notebook views and diffs render it after the last cell.",
		},
		{
			id: "narrow",
			title: "Narrow column",
			description: "In a narrow side-by-side pane the message wraps beside the icon.",
		},
	],
	usages: [
		{
			file: "packages/resource-renderers/src/renderers/code/PierreDiff.tsx",
			note: "First child of the diff scroller, driven by `pending.stale`.",
		},
		{
			file: "packages/resource-renderers/src/renderers/RegionReviewSurface.tsx",
			note: "Between the image or page region surface and its composer.",
		},
		{
			file: "packages/resource-renderers/src/renderers/csv/View.tsx",
			note: "After the table, before the composer and the thread cards.",
		},
		{
			file: "packages/resource-renderers/src/renderers/json/Diff.tsx",
			note: "The JSON diff's composer slot.",
		},
		{
			file: "packages/resource-renderers/src/renderers/notebook/View.tsx",
			note: "After the last cell of a notebook.",
		},
	],
} satisfies ComponentDoc;
