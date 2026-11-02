import type { ConfirmPopover } from "@/panels/ConfirmPopover";
import type { ComponentDoc, PropDoc } from "../types";

type ConfirmPopoverProps = Parameters<typeof ConfirmPopover>[0];

export const confirmPopover = {
	slug: "confirm-popover",
	name: "ConfirmPopover",
	group: "Overlay",
	source: "apps/web/src/panels/ConfirmPopover.tsx",
	preview: "preview",
	tag: "<ConfirmPopover",
	importLine: 'import { ConfirmPopover } from "@/panels/ConfirmPopover";',
	summary:
		"The app's anchored yes/no: a Popover whose panel is a small `alertdialog` with a title, an optional description, Cancel and one confirm button, opening from the control that asked. It owns the panel's layout and width, the button variants, the warning icon of a destructive confirmation and closing after either choice; the call site provides the open state, the words, what confirming does, and the trigger — a `PopoverTrigger` inside its `children`.",
	whenToUse: [
		"Confirming a destructive action that has its own control on screen: the Delete button of a template row, a draft comment's Delete, the review panel's Clear.",
		"A quick check where the page should stay visible and interactive around the question, next to the thing it affects.",
		"Rows that each need their own confirmation: every row renders its own ConfirmPopover with its own open state.",
	],
	alternatives: [
		{
			name: "ConfirmDialog",
			when: "The action has no stable anchor — it was chosen from a menu, a shortcut or a row that may move — or it deserves a modal pause (remove a workspace, stop trusting a project).",
		},
		{
			name: "Popover",
			when: "The panel needs more than two buttons and text: a field, a choice, a gated or loading confirm button.",
		},
		{
			name: "Toast",
			when: "The action is reversible or already done; report it instead of asking first.",
		},
	],
	anatomy: [
		{
			part: "Popover",
			description:
				"A controlled Popover root wrapping `children`, so a `PopoverTrigger` inside them toggles it and anchors the panel.",
		},
		{
			part: "Trigger",
			description:
				"Supplied by the call site: a `PopoverTrigger asChild` somewhere in `children`, on the Button or IconButton that asks. `children` may be a whole row around it.",
		},
		{
			part: "Panel",
			description:
				'PopoverContent with `role="alertdialog"`, `w-288`, `p-12`, `gap-8`, `data-testid="confirm-popover"`, on `side` and `align`.',
		},
		{
			part: "Warning icon",
			description:
				"Only when `destructive`: `RiAlertLine` in `feedback-error` before the title, at icon size 16.",
		},
		{
			part: "Title",
			description: "The `title` string in `tr-title-compact`; the panel's accessible name.",
		},
		{
			part: "Description",
			description:
				"`tr-text-metadata` in `text-text-muted`, rendered only when `description` is given; the accessible description.",
		},
		{
			part: "Cancel",
			description:
				"An `outline` Button at size `m`, first in the footer and so focused on open; label `cancelLabel` or `common.cancel`.",
		},
		{
			part: "Confirm",
			description:
				"A `destructive` Button when `destructive`, otherwise `primary`, at size `m`; label `confirmLabel` or `common.confirm`; `data-testid` from `confirmTestId`.",
		},
	],
	props: {
		open: {
			type: "boolean",
			description: "Required. Controlled open state; keep one per ConfirmPopover (per row).",
		},
		onOpenChange: {
			type: "(open: boolean) => void",
			description:
				"Required. Called with `true` by the trigger and with `false` by Cancel, by Confirm after `onConfirm`, by Escape and by an outside click.",
		},
		title: {
			type: "string",
			description: "Required. The question, naming its object: `Delete {name}?`.",
		},
		description: {
			type: "ReactNode",
			description:
				"What confirming does and whether it can be undone. Omit it when the title says everything (`Delete this draft?`).",
		},
		confirmLabel: {
			type: "string",
			default: 't("common.confirm")',
			description: "The confirm button's label; repeat the action's verb (`Delete`, `Clear`).",
		},
		cancelLabel: {
			type: "string",
			default: 't("common.cancel")',
			description: "The cancel button's label.",
		},
		destructive: {
			type: "boolean",
			default: "false",
			description:
				"Uses the `destructive` confirm button and adds the warning icon before the title.",
		},
		confirmTestId: {
			type: "string",
			description: "`data-testid` on the confirm button, for end-to-end tests.",
		},
		onConfirm: {
			type: "() => void",
			description:
				"Required. Runs when Confirm is pressed, just before the panel closes. Start the action here; the panel does not wait for it.",
		},
		side: {
			type: '"top" | "right" | "bottom" | "left"',
			default: '"bottom"',
			description: "Preferred side of the trigger; Radix flips it when there is no room.",
		},
		align: {
			type: '"start" | "center" | "end"',
			default: '"start"',
			description:
				"Alignment against the trigger. Every call site passes `end`, because the trigger sits at the trailing edge of a row or header.",
		},
		children: {
			type: "ReactNode",
			description:
				"Required. The content that contains the `PopoverTrigger` — the trigger alone, or the row it lives in.",
		},
	} satisfies Record<keyof ConfirmPopoverProps, PropDoc>,
	states: [
		{
			state: "Closed",
			how: "`open` is false.",
			appearance: 'Only `children` render; the trigger carries `data-state="closed"`.',
		},
		{
			state: "Open, destructive",
			how: "`open` with `destructive`.",
			appearance:
				"`feedback-error` warning icon before the title; `outline` Cancel beside a `destructive` confirm button. A Button or IconButton trigger shows its selected fill.",
		},
		{
			state: "Open, neutral",
			how: "`open` without `destructive`.",
			appearance: "Title without an icon; `outline` Cancel beside a `primary` confirm button.",
		},
		{
			state: "No description",
			how: "`description` omitted.",
			appearance: "Only the title above the buttons; no `aria-describedby`.",
		},
		{
			state: "Long title",
			how: "A long `title` such as a long template name.",
			appearance: "Wraps inside the fixed `w-288` panel; the panel never grows.",
		},
		{
			state: "Busy, disabled",
			how: "—",
			appearance:
				"No distinct treatment: neither button can be disabled or show loading, and the panel closes as soon as Confirm is pressed.",
		},
	],
	accessibility: [
		'The panel is `role="alertdialog"`, named by the title (`aria-labelledby`) and described by the description (`aria-describedby`) when there is one.',
		"Cancel is the first focusable element, so it receives focus when the panel opens; a stray Enter cancels instead of confirming.",
		"Non-modal: the page stays interactive. Tab wraps between Cancel and Confirm; Escape and an outside click close it like Cancel.",
		"After Cancel, Confirm or Escape focus returns to the trigger; after an outside click it stays where the user clicked. If the action removes the trigger, focus falls to the document body.",
		"The trigger is a real button with an accessible name — an IconButton `label` or the Button's text — and gets `aria-expanded` from the popover.",
		"The warning icon is decoration; the title and the confirm label must say what is destructive.",
	],
	keyboard: [
		{ keys: "Enter / Space", action: "On the trigger: opens the panel with Cancel focused." },
		{
			keys: "Tab / Shift+Tab",
			action: "Moves between Cancel and Confirm, wrapping inside the panel.",
		},
		{ keys: "Enter / Space", action: "In the panel: activates the focused button." },
		{ keys: "Escape", action: "Closes without confirming and returns focus to the trigger." },
	],
	rules: [
		{
			id: "CFP-1",
			text: "Use ConfirmPopover when the question belongs to a control that stays on screen; use ConfirmDialog when it comes from a menu, a shortcut or a row that may move. Do not assemble a confirmation from Popover parts.",
		},
		{
			id: "CFP-2",
			text: "Put exactly one `PopoverTrigger asChild` in `children`, on the Button or IconButton that asks; add `wrapTrigger` so its tooltip and the popover keep separate `data-state`. `children` may be the trigger alone or the row that contains it.",
		},
		{
			id: "CFP-3",
			text: 'Set `destructive` when confirming deletes, discards or archives something; the trigger then reads as dangerous with `tone="danger"`, not with colour classes.',
		},
		{
			id: "CFP-4",
			text: "Write the title as the question with its object and pass a `confirmLabel` that repeats the verb; add a `description` only when it says what is lost or kept.",
		},
		{
			id: "CFP-5",
			text: "Each row owns its own open state and ConfirmPopover; `onConfirm` acts on that row's data.",
		},
		{
			id: "CFP-6",
			text: "`onConfirm` starts the action and the panel closes at once: report failure with a toast. A confirmation that must be disabled or show progress is a Popover with its own buttons.",
		},
		{
			id: "CFP-7",
			text: 'Pass `align="end"` for triggers at a trailing edge, and give the confirm button a `confirmTestId`.',
		},
	],
	examples: [
		{
			id: "preview",
			title: "Delete from a row",
			description:
				"A template row as `children`; its Delete IconButton is the trigger and the panel aligns to its end.",
		},
		{
			id: "title-only",
			title: "Title only",
			description: "Deleting a draft comment: the title says it all, so there is no description.",
		},
		{
			id: "header-action",
			title: "Header action",
			description:
				"The review panel's Clear: a text Button with a tooltip and a confirm label that repeats the verb.",
		},
		{
			id: "per-row",
			title: "One per row",
			description: "Each draft row keeps its own open state; confirming removes that row.",
		},
		{
			id: "neutral",
			title: "Neutral",
			description:
				"Without `destructive`: no icon and a `primary` confirm. No production call site uses the neutral style yet.",
		},
		{
			id: "open-upward",
			title: "Opening upward",
			description: '`side="top"` for a trigger near the bottom of a surface.',
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/TemplatesSettings.tsx",
			note: 'Delete a template: the row is `children`, destructive with a description, `align="end"`.',
		},
		{
			file: "apps/web/src/panels/ReviewPanel.tsx",
			note: "Clear the review from the panel header, and Delete a draft comment (title only).",
		},
	],
} satisfies ComponentDoc;
