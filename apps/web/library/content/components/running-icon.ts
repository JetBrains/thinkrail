import type { ComponentProps } from "react";
import type { RunningIcon } from "@/components/RunningIcon";
import type { ComponentDoc, PropDoc } from "../types";

type RunningIconProps = ComponentProps<typeof RunningIcon>;

export const runningIcon = {
	slug: "running-icon",
	name: "RunningIcon",
	group: "Feedback",
	source: "apps/web/src/components/RunningIcon.tsx",
	preview: "preview",
	tag: "<RunningIcon",
	importLine: 'import { RunningIcon } from "@/components/RunningIcon";',
	summary:
		"The “ThinkRail is working” badge: the brand monogram inside a split rounded-square frame that draws and erases while an agent works. It is drawn in `currentColor`, so it sizes with `size-*` and colours with `text-*` exactly like a Remix icon, and it carries the accessible label “Agent working”. The call site decides from normalized host state whether a session is running and passes only size and colour classes.",
	whenToUse: [
		"A top-level session is genuinely working: render it **in place of** the row's identity glyph (folder, branch, chat) — ProjectTree workspace and collapsed-project rows, the location bar's *Switch to* menu, the session switcher.",
		"The decorative badge beside a live phase label in the chat stream footer (`StreamIndicator`), where the label is the announcement.",
		"Anywhere “an agent is working here” must read at icon size and in the surrounding glyph colour.",
	],
	alternatives: [
		{
			name: "Button",
			when: "An in-flight action pinned to its control — `loading` (or `loading spinIcon` for a refresh) on Button or IconButton, never RunningIcon.",
		},
		{
			name: "LoadingRegion and SkeletonRows",
			when: "A content region waiting for data (the loading pattern's first tier).",
		},
		{
			name: "AttentionDot",
			when: "The session needs the user (a question or an unread result), not that it is working. The two can coexist on one row.",
		},
		{
			name: "AttentionLine",
			when: "A chat-level “needs your answer” line with its own live announcement.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description:
				'An `inline-flex` `<span role="img">` that never shrinks, labelled “Agent working”, with `data-testid="running-icon"` and `data-running="true"`. Your `size-*` and `text-*` classes land here.',
		},
		{
			part: "Frame",
			description:
				"Two `aria-hidden` SVG halves of a rounded square (`running-icon-frame`), leaving a gap on the left and meeting on the right; they draw and erase with `animate-loader-frame`.",
		},
		{
			part: "Monogram",
			description:
				"Six wide letter strokes of the “TR” mark, each clipped to its region of `BRAND_MARK_SEGMENTS` (the shell logo's own segments), animated by the `loader-t-*` / `loader-r-*` keyframes.",
		},
		{
			part: "Clip paths",
			description:
				"One `<clipPath>` per monogram segment with an id from `useId`, so any number of badges on a page never share ids.",
		},
	],
	props: {
		className: {
			type: "string",
			description:
				"Size and colour only: a `size-*` class (`size-14` in rows and menus, `size-16` in the chat footer) and the `text-*` the replaced glyph would wear (`text-primary` active, `text-text-muted` inactive), plus placement such as `mt-2` in a two-line row.",
		},
	} satisfies Record<keyof RunningIconProps, PropDoc>,
	sections: [
		{
			id: "sizes",
			title: "Sizes and colours",
			description:
				"Every cell is the real badge. It takes its size from `size-*` and its colour from `text-*` through `currentColor`; with reduced motion enabled in the OS every cell shows the static, complete mark.",
			table: {
				head: ["Class", "Use it for"],
				rows: [
					["`size-14`", "Rows and menus: ProjectTree, the session switcher, the *Switch to* menu."],
					["`size-16`", "The chat stream footer, beside the phase label."],
					[
						"`size-64`",
						"Not a production size — a large specimen to read the draw-and-erase cycle.",
					],
					["`text-primary`", "The active or highlighted row, and the chat footer."],
					[
						"`text-text-muted`",
						"An inactive row; a Command row switches to primary while highlighted.",
					],
				],
			},
		},
	],
	states: [
		{
			state: "Running",
			how: "Rendered, with motion allowed.",
			appearance:
				"The frame and the six monogram strokes draw and erase on one shared cycle; a beat with only the frame showing is part of the design.",
		},
		{
			state: "Reduced motion",
			how: "`prefers-reduced-motion: reduce`.",
			appearance:
				"Every stroke stays at its fully drawn dash (`motion-safe:` animations off): the static, complete brand mark in the frame.",
		},
		{
			state: "Not running",
			how: "The call site does not render it.",
			appearance:
				"No idle, paused or stopped look — the row shows its identity glyph again. Queued, background, stopped and quiet sessions are not running.",
		},
		{
			state: "Active / selected row",
			how: "The call site's colour class (`text-primary`, or `group-data-[selected=true]:text-primary` in a Command row).",
			appearance:
				"Takes the colour through `currentColor`; the component has no colour of its own.",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance:
				"No distinct treatment; the badge is not interactive and inherits the row's state.",
		},
	],
	accessibility: [
		'Renders `role="img"` with the localized label “Agent working” (`components.runningIcon.label`); the SVG inside is `aria-hidden`.',
		"Inside a row button, menu item or command option the label becomes part of that control's name, so the running state is read with the row and never needs a tooltip.",
		'Where an adjacent live label already announces the work, wrap it in `<span aria-hidden="true">` as `StreamIndicator` does, so screen readers hear the phase once.',
		"Motion respects `prefers-reduced-motion`; the static badge keeps the same shape and name, so no information depends on the animation.",
		"Drawn in `currentColor`, so it follows the row's text colour in every theme.",
	],
	keyboard: [
		{
			keys: "—",
			action:
				"Not focusable. Keyboard behaviour belongs to the row, menu item or option it sits in.",
		},
	],
	rules: [
		{
			id: "RUN-1",
			text: "Show it only while a top-level session is genuinely working, from normalized host state (`selectWorkspaceIsRunning` and friends) — never for queued, background, stopped or quiet sessions.",
		},
		{
			id: "RUN-2",
			text: "Render it **in place of** the identity glyph, never beside it as a second marker; when work stops the glyph returns.",
		},
		{
			id: "RUN-3",
			text: "Pass only `size-*`, the replaced glyph's `text-*` colour and placement. Do not recolour parts, add a spinner, dot, count or tooltip, or wrap it in a pulse.",
		},
		{
			id: "RUN-4",
			text: "For an in-flight action on a control use Button or IconButton `loading`; for a waiting region use LoadingRegion. RunningIcon means “an agent is working”, nothing else.",
		},
		{
			id: "RUN-5",
			text: 'When a visible live label already says what is happening, hide the badge from assistive technology with an `aria-hidden="true"` wrapper (the chat stream footer).',
		},
		{
			id: "RUN-6",
			text: "It is orthogonal to attention: a session that needs input but is still running shows both the badge and the AttentionDot.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Working badge",
			description:
				"The badge at row size in the active and inactive colours, and at the chat-footer size.",
		},
		{
			id: "identity-swap",
			title: "Replaces the identity glyph",
			description:
				"A workspace row swaps its branch glyph for the badge while an agent works; toggle the run to see the glyph return.",
		},
		{
			id: "row-colour",
			title: "Row colour",
			description:
				"The badge wears the colour the replaced glyph would: `text-primary` on the active row, `text-text-muted` elsewhere.",
		},
		{
			id: "two-line-row",
			title: "Two-line row",
			description:
				"In a row with a branch line the badge aligns to the first line with `mt-2`, like the glyph it replaces.",
		},
		{
			id: "stream-footer",
			title: "Chat stream footer",
			description:
				"`StreamIndicator` shows the badge decoratively beside the live phase label, which is the announcement.",
		},
		{
			id: "menu-item",
			title: "Switch to menu",
			description:
				"In a dropdown the running workspace's item leads with the badge instead of its branch icon. The menu row's own icon rule (`[&_svg]:text-text-muted`) currently colours the badge's SVG muted, so the `text-primary` passed here does not show.",
		},
		{
			id: "command-row",
			title: "Session switcher rows",
			description:
				"Muted at rest and primary on the highlighted option, through the row's `group-data-[selected=true]` colour.",
		},
		{
			id: "with-attention",
			title: "Working and needs attention",
			description: "A session waiting on input while still running shows the badge and the dot.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ProjectTree.tsx",
			note: "Replaces the project folder and workspace branch glyph while a session works (`size-14`, primary or muted).",
		},
		{
			file: "apps/web/src/chat/StreamIndicator.tsx",
			note: "Decorative `size-16 text-primary` badge beside the stream phase label.",
		},
		{
			file: "apps/web/src/shell/SessionSwitcher.tsx",
			note: "Replaces the chat glyph on running session rows; primary while the option is highlighted.",
		},
		{
			file: "apps/web/src/shell/locationBar/WorkspaceSegment.tsx",
			note: "Leads a running workspace's item in the *Switch to* menu.",
		},
	],
} satisfies ComponentDoc;
