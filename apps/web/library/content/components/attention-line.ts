import type { AttentionLine } from "@thinkrail/ui/attention-line";
import type { ComponentDoc, PropDoc } from "../types";

type AttentionLineProps = Parameters<typeof AttentionLine>[0];

export const attentionLine = {
	slug: "attention-line",
	name: "AttentionLine",
	group: "Feedback",
	source: "packages/ui/attention-line.tsx",
	preview: "preview",
	tag: "<AttentionLine",
	importLine: 'import { AttentionLine } from "@thinkrail/ui/attention-line";',
	summary:
		"The one-line “Your input is needed · Agent is waiting” heading above a chat surface the agent is blocked on. It owns the icon, the fixed words, their colour and type, and an optional polite live region that announces the wait once. The call site decides whether the line is shown at all and, through `announced` and `live`, which copy of the message assistive technology hears.",
	whenToUse: [
		"Directly above an inline prompt the host is waiting on — an `ask_user_question` card or an extension `select` / `confirm` / `input` / `editor` prompt.",
		"Only while the host is actually waiting on that request; remove it the moment it no longer is.",
		"When the waiting surface should announce itself politely once, without moving focus.",
	],
	alternatives: [
		{
			name: "AttentionDot",
			when: "A row in a list or rail (a project, a session) needs attention; the dot marks it without words.",
		},
		{
			name: "StaleComposerNotice",
			when: "A notice about the composer's own state, not a request the agent is waiting on.",
		},
		{
			name: "SettingsNotice",
			when: "A persistent status or warning inside a settings surface.",
		},
		{
			name: "Toast",
			when: "A transient confirmation or failure after an action, not a blocking request.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description: "A `div`, `flex items-center gap-4`, in `text-primary` and `tr-text-action`.",
		},
		{
			part: "Visible line",
			description:
				"A span holding the icon and both texts; `aria-hidden` once `announced` is set or when `live` is `false`.",
		},
		{
			part: "Icon",
			description: "`RiQuestionnaireLine` at `size-14`, in the line's `primary` colour.",
		},
		{
			part: "Message",
			description: "“Your input is needed” (`chat.attention.needed`).",
		},
		{
			part: "Waiting note",
			description:
				"“· Agent is waiting” (`chat.attention.waiting`) in `tr-text-metadata`, `text-muted`.",
		},
		{
			part: "Live region",
			description:
				'Rendered only when `live`: an `sr-only` `role="status"` `aria-live="polite"` span, empty until `announced`, then “Your input is needed — the agent is waiting.” (`chat.attention.announcement`).',
		},
	],
	props: {
		announced: {
			type: "boolean",
			default: "false",
			description:
				"Fills the live region with the announcement and hides the visible line from assistive technology, so exactly one copy is read. Set it a frame after mount, once per request.",
		},
		live: {
			type: "boolean",
			default: "true",
			description:
				"Renders the component's own polite live region. Pass `false` when a surrounding owner announces the request; the visible line is then always `aria-hidden`.",
		},
	} satisfies Record<keyof AttentionLineProps, PropDoc>,
	states: [
		{
			state: "Waiting, not yet announced",
			how: "Default props.",
			appearance:
				"The primary line with the muted waiting note; the empty live region is mounted and the visible line is exposed to assistive technology.",
		},
		{
			state: "Announced",
			how: "`announced`.",
			appearance:
				"Looks the same; the live region carries the announcement and the visible line is `aria-hidden`.",
		},
		{
			state: "Announced elsewhere",
			how: "`live={false}`.",
			appearance: "Looks the same; no live region, and the visible line is `aria-hidden`.",
		},
		{
			state: "Narrow",
			how: "A container narrower than the line.",
			appearance:
				"The message and the waiting note each wrap in their own column beside the icon, which keeps its size (`shrink-0`).",
		},
		{
			state: "Hover, focus, disabled",
			how: "—",
			appearance: "No distinct treatment; the line is not interactive.",
		},
	],
	accessibility: [
		'The live region is a polite `role="status"` that is mounted with the line and filled later: a region inserted together with its text is announced unreliably.',
		"Exactly one copy is in the accessibility tree. Before `announced` the visible line is read; after it, only the region's announcement; with `live={false}` neither, because the owner's region speaks.",
		"A remount (a virtualised row coming back) starts with `announced={false}`, so the region stays empty and the visible line is exposed again without a second announcement.",
		"The line never takes focus; any focus claim belongs to the waiting card or prompt.",
		"Colour is not the only signal: the line is words; the icon has no accessible name of its own.",
	],
	keyboard: [{ keys: "—", action: "Not focusable; the line has no keyboard interaction." }],
	rules: [
		{
			id: "ATL-1",
			text: "Show the line only while the host is waiting on this request (`canRespond ? <AttentionLine … /> : null`). A call the host is not waiting on never asks for attention.",
		},
		{
			id: "ATL-2",
			text: "Place it directly above the waiting surface in a `flex flex-col gap-4` stack, so it reads as that surface's heading. One line per waiting surface.",
		},
		{
			id: "ATL-3",
			text: "When the line owns the announcement, keep it mounted from the first render and set `announced` a frame later through a one-shot claim per request; never re-announce on a remount.",
		},
		{
			id: "ATL-4",
			text: "When a surrounding owner already announces the request (the chat transcript's polite region for extension prompts), pass `live={false}` so the message is not read twice.",
		},
		{
			id: "ATL-5",
			text: "Do not recreate or restyle it: the words are fixed locale keys and the component takes no `className`. Put the question itself in the card, not in the line.",
		},
		{
			id: "ATL-6",
			text: "Not for list markers or unread results — use AttentionDot there.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Basic",
			description: "The default line: its own live region, mounted empty.",
		},
		{
			id: "announced",
			title: "One-shot announcement",
			description:
				"`announced` is set a frame after mount, so the polite region speaks once and the visible line leaves the accessibility tree.",
		},
		{
			id: "not-live",
			title: "Announced by the owner",
			description:
				"`live={false}` beside the owner's always-mounted polite region, as the chat transcript does for extension prompts.",
		},
		{
			id: "ext-ui-prompt",
			title: "Extension prompt",
			description:
				"The real extension `confirm` prompt, which heads itself with `<AttentionLine live={false} />`.",
		},
		{
			id: "awaiting",
			title: "Only while waiting",
			description:
				"The line is present only while a response is accepted; answering removes it. Retry asks again.",
		},
		{
			id: "narrow",
			title: "Narrow container",
			description:
				"In a narrow column the message and the waiting note wrap side by side; give the line the width of its card instead.",
		},
	],
	usages: [
		{
			file: "thinkrail-extensions/ask-user-question/web/AskUserQuestionCard.tsx",
			note: "`canRespond ? <AttentionLine announced={announced} /> : null` above the question card; `announced` set by the one-shot attention claim.",
		},
		{
			file: "apps/web/src/chat/ExtUiPrompt.tsx",
			note: "`<AttentionLine live={false} />` above every extension prompt; `ChatTranscript` owns the polite announcement.",
		},
	],
} satisfies ComponentDoc;
