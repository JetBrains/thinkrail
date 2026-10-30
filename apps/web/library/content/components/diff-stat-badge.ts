import type { ComponentProps } from "react";
import type { DiffStatBadge } from "@/panels/DiffStatBadge";
import type { ComponentDoc, PropDoc } from "../types";

type DiffStatBadgeProps = ComponentProps<typeof DiffStatBadge>;

export const diffStatBadge = {
	slug: "diff-stat-badge",
	name: "DiffStatBadge",
	group: "Data display",
	source: "apps/web/src/panels/DiffStatBadge.tsx",
	preview: "preview",
	tag: "<DiffStatBadge",
	importLine: 'import { DiffStatBadge } from "@/panels/DiffStatBadge";',
	summary:
		"The one `+N −M` diff-count badge: lines added in the success colour, lines removed in the error colour, in metadata type with tabular figures. It owns the signs, colours, type and its own absence — it renders nothing when both counts are zero. The call site passes the two counts (a file's, a folder's aggregate, a commit's or a whole scope's) and places it in a row.",
	whenToUse: [
		"A changed file's line counts, trailing its row in the Changes list or tree, a plan step's file list or a review section header.",
		"A collapsed folder's aggregate in the Changes tree — only while it is collapsed; an expanded folder's children already carry the counts.",
		"The size of a commit, a revision or a plan step's change set, next to its short sha.",
		"The totals of a review scope or a workspace's branch, inline with other metadata such as a file count.",
	],
	alternatives: [
		{
			name: "AttentionDot",
			when: "A row needs the user's attention; a presence marker, not a magnitude.",
		},
		{
			name: "RunningIcon",
			when: "Work is in progress; the badge reports a finished diff, never activity.",
		},
		{
			name: "FileChip",
			when: "A file or attachment is the object itself (a composer image, an attachment in the transcript), not a count about it.",
		},
		{
			name: "TreeRow",
			when: "The file row itself; the badge goes into its `trailing` slot.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description:
				"An inline `<span>` in `tr-text-metadata` with `tabular-nums` and `shrink-0`, so it never gives way in a flex row; `className` is appended.",
		},
		{
			part: "Added",
			description: "`+` and `added`, in `text-feedback-success`.",
		},
		{ part: "Separator", description: "A single space between the two counts." },
		{
			part: "Removed",
			description:
				"`−` (the minus sign U+2212, not a hyphen) and `removed`, in `text-feedback-error`.",
		},
	],
	props: {
		added: {
			type: "number",
			description:
				"Lines added. Always shown (as `+0` when only lines were removed). Pass `?? 0` for an optional count such as `GitFileChange.added`.",
		},
		removed: {
			type: "number",
			description:
				"Lines removed. Always shown (as `−0` when only lines were added). When both counts are zero or below the badge renders `null`.",
		},
		className: {
			type: "string",
			description:
				"Placement only (margins, order, responsive visibility). Production passes none; the badge owns its type and colours.",
		},
	} satisfies Record<keyof DiffStatBadgeProps, PropDoc>,
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"Every cell in the last column is the real component with the props shown. The empty case is the component returning `null`.",
		},
	],
	states: [
		{
			state: "Added and removed",
			how: "Both counts positive.",
			appearance: "`+N` in the success colour, a space, `−M` in the error colour.",
		},
		{
			state: "One-sided",
			how: "One count is `0`.",
			appearance: "Both sides still render: `+34 −0` or `+0 −12`. The zero side keeps its colour.",
		},
		{
			state: "Empty",
			how: "Both counts `0` (or below).",
			appearance:
				"Renders nothing — no `+0 −0`, no placeholder, and the row's gap closes. A call site that has no stat at all (`stat ? … : null`) gets the same result.",
		},
		{
			state: "Long numbers",
			how: "Large counts (a whole branch).",
			appearance:
				"Tabular figures keep digits aligned; the badge never truncates or shrinks, so the neighbouring label gives way instead.",
		},
		{
			state: "Hover, focus, selected, disabled",
			how: "—",
			appearance:
				"No distinct treatment; the badge is not interactive and keeps its colours on a hovered or active row.",
		},
	],
	accessibility: [
		"Plain inline text with no role or label: it is read as part of its row, for example “+12 −4” after the file name inside a TreeRow button.",
		"The meaning is carried by the `+` and `−` signs, not only by colour.",
		"It is not a live region; a changing count is not announced.",
		"Inside an interactive row the row is the focus target and the badge's text becomes part of the row's accessible name.",
	],
	keyboard: [{ keys: "—", action: "None. The badge is never focusable; the row around it is." }],
	rules: [
		{
			id: "DSB-1",
			text: "Every `+N −M` line count is a DiffStatBadge — never hand-written `+`/`−` spans with success and error colours.",
		},
		{
			id: "DSB-2",
			text: "Pass the counts and let the badge hide itself: do not guard `added + removed > 0` at the call site, and do not render `+0 −0`. Default an optional count with `?? 0`.",
		},
		{
			id: "DSB-3",
			text: "Place it after the label in a row's trailing position (a TreeRow's `trailing`, after a truncating path). The badge is `shrink-0`; the label is what truncates.",
		},
		{
			id: "DSB-4",
			text: "Show a folder's aggregate only while the folder is collapsed; once expanded, its children carry the counts.",
		},
		{
			id: "DSB-5",
			text: "Use it for line counts of a diff only — not for file counts, finding counts or review progress, which are their own metadata text beside it.",
		},
		{
			id: "DSB-6",
			text: "No colour, type or weight classes at the call site; `className` is placement only, such as hiding it below `sm` with its sha in a dense meta strip.",
		},
	],
	examples: [
		{ id: "preview", title: "Badge", description: "Lines added and removed for one change." },
		{
			id: "counts",
			title: "Counts",
			description:
				"Both sides always render once either is positive; tabular figures keep large counts aligned.",
		},
		{
			id: "empty",
			title: "Empty scope",
			description:
				"A scope with no line changes renders no badge — switch the scope to see it disappear without a guard at the call site.",
		},
		{
			id: "tree",
			title: "Changes tree",
			description:
				"Per-file badges in TreeRow's `trailing`; a folder shows its aggregate only while collapsed — click the folder.",
		},
		{
			id: "file-rows",
			title: "Plan file rows",
			description:
				"The plan's changed-file rows, where an optional count defaults with `?? 0` and a file without counts shows no badge.",
		},
		{
			id: "review-summary",
			title: "Review summary",
			description:
				"Scope totals between the file count and the viewed count in the review header's metadata line.",
		},
		{
			id: "revisions",
			title: "Commit meta",
			description:
				"Beside a short sha in a revision list; a revision whose stat no longer resolves shows no badge.",
		},
		{
			id: "narrow",
			title: "Narrow row",
			description: "In a narrow pane the file name truncates and the badge keeps its full width.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ChangesTree.tsx",
			note: "Per-file badge in TreeRow `trailing`; a folder's aggregate only while collapsed.",
		},
		{
			file: "apps/web/src/panels/ChangesPanel.tsx",
			note: "Flat list rows after the truncating path and the viewed mark.",
		},
		{
			file: "apps/web/src/panels/ChangesFileSection.tsx",
			note: "Review section header, after the status letter and path.",
		},
		{
			file: "apps/web/src/panels/ChangesReviewPane.tsx",
			note: "Scope totals between the file count and the viewed count.",
		},
		{
			file: "apps/web/src/panels/PlanPane.tsx",
			note: "Change-set summary, step meta strip (hidden below `sm` with the sha), revisions and the branch totals.",
		},
		{
			file: "apps/web/src/panels/planFileRow.tsx",
			note: "Plan change-set file rows with `?? 0` counts.",
		},
	],
} satisfies ComponentDoc;
