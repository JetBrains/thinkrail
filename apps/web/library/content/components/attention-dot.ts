import type { ComponentProps } from "react";
import type { AttentionDot } from "@/components/AttentionDot";
import type { ComponentDoc, PropDoc } from "../types";

type AttentionDotProps = ComponentProps<typeof AttentionDot>;

export const attentionDot = {
	slug: "attention-dot",
	name: "AttentionDot",
	group: "Feedback",
	source: "apps/web/src/components/AttentionDot.tsx",
	preview: "preview",
	tag: "<AttentionDot",
	importLine: 'import { AttentionDot } from "@/components/AttentionDot";',
	summary:
		"The one “needs attention” marker: a static accent dot in its own square column, labelled “Needs attention”. It is binary — a session waiting for input and a session with an unread result show the same dot — and it carries no reason, count, tooltip or motion. The call site decides only whether it is present, from normalized host state.",
	whenToUse: [
		"A workspace, collapsed project or session needs the user: a question or dialog is waiting, or a finished, failed or interrupted run has an unread result.",
		"Rows in ProjectTree, project headings and session rows in the session switcher — trailing the identity button, in its own flex column.",
		"Any list that must mirror the rail's attention signal; out-of-app notifications fire on the same dot lighting up.",
	],
	alternatives: [
		{
			name: "RunningIcon",
			when: "The session is working, not waiting for the user. Both can show on one row.",
		},
		{
			name: "AttentionLine",
			when: "Inside the chat itself, where the reason (“Your input is needed”) should be spelled out and announced.",
		},
		{
			name: "DiffStatBadge",
			when: "A count or a magnitude must be shown; the dot never carries a number.",
		},
		{
			name: "Toast",
			when: "A one-off event the user should notice now, rather than a persistent state on a row.",
		},
	],
	anatomy: [
		{
			part: "Box",
			description:
				'A `<span role="img">` labelled “Needs attention” (`data-testid="attention-dot"`): a fixed `size-20` flex square that never shrinks and centres the dot, so it lines up with the row\'s other trailing controls.',
		},
		{
			part: "Dot",
			description: "An `aria-hidden` `size-6` `rounded-full` circle filled with `bg-primary`.",
		},
	],
	props: {
		className: {
			type: "string",
			description:
				"Placement only (margins, order). Production passes none; the dot owns its size and colour.",
		},
	} satisfies Record<keyof AttentionDotProps, PropDoc>,
	sections: [
		{
			id: "states",
			title: "States",
			description:
				"The rail's two treatments from normalized host state, rendered with the real components. Attention is binary; working replaces the glyph; the two are orthogonal.",
			table: {
				head: ["Session", "Host state", "Markers"],
				rows: [
					["Quiet", "Quiet, queued, stopped or in the background", "identity glyph"],
					["Working", "Working", "RunningIcon"],
					["Waiting", "Waiting for input (`needsInput`)", "identity glyph + AttentionDot"],
					[
						"Unread",
						"Finished, failed or interrupted, unread (`completionUnread`)",
						"identity glyph + AttentionDot",
					],
					[
						"Waiting while running",
						"Waiting for input while still running",
						"RunningIcon + AttentionDot",
					],
				],
			},
		},
	],
	states: [
		{
			state: "Present",
			how: "The call site renders it because attention is positive (`needsInput !== null || completionUnread`).",
			appearance: "The static accent dot. Identical for every reason.",
		},
		{
			state: "Absent",
			how: "The call site does not render it.",
			appearance:
				"Nothing — there is no hidden, zero or read state, and the column collapses (rows keep `data-attention` only while positive).",
		},
		{
			state: "Hover, focus, selected, disabled",
			how: "—",
			appearance:
				"No distinct treatment; the dot is not interactive and does not react to the row's state.",
		},
		{ state: "Motion", how: "—", appearance: "None. It never pulses or animates." },
	],
	accessibility: [
		'Renders `role="img"` with the localized label “Needs attention” (`components.attentionDot.label`); the inner circle is `aria-hidden`.',
		"Inside a command option or row the label is read with that row, so the state is never colour-only.",
		"There is no tooltip and no per-reason label by design; the reason is found by opening the session.",
		"Clearing is the call site's job (opening the session, *Mark as read*); the dot itself has no dismiss affordance.",
	],
	keyboard: [
		{
			keys: "—",
			action: "Not focusable. Keyboard behaviour belongs to the row or option it sits in.",
		},
	],
	rules: [
		{
			id: "ATD-1",
			text: "One marker for every attention reason: needs-input and unread-result use the same AttentionDot — no question, check or result glyph, and no status-specific tooltip.",
		},
		{
			id: "ATD-2",
			text: "Decide presence only from normalized host state (`selectWorkspaceNeedsAttention`, the switcher groups), never from client-side guesses; render it or not, with no other prop.",
		},
		{
			id: "ATD-3",
			text: "Give it its own flex column after the identity button and before hover-revealed row actions; do not overlay it on an icon or put it inside the name.",
		},
		{
			id: "ATD-4",
			text: "Never add a count, reason text, colour, size or motion at the call site; `className` is for placement only.",
		},
		{
			id: "ATD-5",
			text: "Attention is orthogonal to running: a running session that needs input shows RunningIcon in place of its glyph and the dot as well.",
		},
		{
			id: "ATD-6",
			text: "Let the user clear an unread result where the dot appears (*Mark as read* in the row menu), and offer *Mark as unread* to bring it back.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Needs attention",
			description: "The dot trailing a workspace row, in its own column.",
		},
		{
			id: "workspace-rows",
			title: "Workspace rows",
			description:
				"Rows that need attention carry the dot between the identity button and the hover-revealed actions; quiet rows have nothing there.",
		},
		{
			id: "one-marker",
			title: "One marker for every reason",
			description:
				"The second line names each reason for this demo only; the rail shows the same dot for a waiting question and for a finished or failed run, and never says which.",
		},
		{
			id: "mark-read",
			title: "Mark as read",
			description:
				"The row menu clears the unread result and brings it back; the call site decides presence.",
		},
		{
			id: "with-running",
			title: "Working and needs attention",
			description: "A running session that waits on input shows RunningIcon and the dot together.",
		},
		{
			id: "session-switcher",
			title: "Session switcher",
			description:
				"A project heading shows the dot when any session needs attention, and each waiting session row trails one.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ProjectTree.tsx",
			note: "Workspace rows and collapsed project rows, between the identity button and the row actions.",
		},
		{
			file: "apps/web/src/shell/SessionSwitcher.tsx",
			note: "Project group headings and every non-running session row.",
		},
	],
} satisfies ComponentDoc;
