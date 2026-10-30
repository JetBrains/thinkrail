import type { ConfirmDialog } from "@/panels/ConfirmDialog";
import type { ComponentDoc, PropDoc } from "../types";

type ConfirmDialogProps = Parameters<typeof ConfirmDialog>[0];

export const confirmDialog = {
	slug: "confirm-dialog",
	name: "ConfirmDialog",
	group: "Overlay",
	source: "apps/web/src/panels/ConfirmDialog.tsx",
	preview: "preview",
	tag: "<ConfirmDialog",
	importLine: 'import { ConfirmDialog } from "@/panels/ConfirmDialog";',
	summary:
		"The app's modal yes/no: a narrow `alertdialog` built on Dialog with a title, an optional description, Cancel and one confirm button. It owns the layout, the button variants, the warning icon of a destructive confirmation and closing after either choice; the call site provides the open state, the words and what confirming does.",
	whenToUse: [
		"Confirming an action that has no stable anchor on screen: it was chosen from a menu, a shortcut or a row that may move (close a project, remove a workspace).",
		"Confirming an irreversible or risky step before it runs: remove an MCP server, close a terminal with a running process, delete a remote branch, stop trusting a project.",
		"Asking before a consequential but safe step: initialise a git repository, push straight to the base branch, apply a layout.",
	],
	alternatives: [
		{
			name: "ConfirmPopover",
			when: "The question belongs to a dedicated control that stays on screen (deleting a template); the popover anchors to it.",
		},
		{
			name: "Dialog",
			when: "The decision needs more than two buttons and text: fields, a gated or loading confirm button, a live count (Stop all subagents).",
		},
		{
			name: "Toast",
			when: "The action is reversible or already done; report it instead of asking first.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description:
				'DialogContent with `role="alertdialog"`, `hideClose`, `max-w-[24rem]` and `data-testid="confirm-dialog"`, over the Dialog overlay.',
		},
		{
			part: "Warning icon",
			description:
				"Only when `destructive`: `RiAlertLine` in `feedback-error` before the title, at icon size 16.",
		},
		{ part: "Title", description: "DialogTitle with the `title` string; the accessible name." },
		{
			part: "Description",
			description: "DialogDescription, rendered only when `description` is given.",
		},
		{
			part: "Cancel",
			description:
				"An `outline` Button, first in the footer and so focused on open; label `cancelLabel` or `common.cancel`.",
		},
		{
			part: "Confirm",
			description:
				"A `destructive` Button when `destructive`, otherwise `primary`; label `confirmLabel` or `common.confirm`; `data-testid` from `confirmTestId`.",
		},
	],
	props: {
		open: {
			type: "boolean",
			description:
				"Required. Controlled open state, usually derived from the pending target (`open={target !== null}`).",
		},
		onOpenChange: {
			type: "(open: boolean) => void",
			description:
				"Required. Called with `false` by Cancel, by Confirm after `onConfirm`, by Escape and by an overlay click. Clear the pending target here.",
		},
		title: {
			type: "string",
			description: "Required. The question, naming its object: `Close {name}?`.",
		},
		description: {
			type: "ReactNode",
			description:
				"What confirming does and what it keeps. A string, or `<T>` with an emphasised name or path.",
		},
		confirmLabel: {
			type: "string",
			default: 't("common.confirm")',
			description:
				"The confirm button's label; repeat the action's verb (`Close project`, `Remove`).",
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
				"Required. Runs when Confirm is pressed, just before the dialog closes. Start the action here; the dialog does not wait for it.",
		},
		onClosedAutoFocus: {
			type: "() => void",
			description:
				"Called instead of the default focus return after closing (it prevents Radix's). Without it focus lands on the document body, because ConfirmDialog has no trigger; focus the row or button the dialog came from.",
		},
	} satisfies Record<keyof ConfirmDialogProps, PropDoc>,
	states: [
		{
			state: "Closed",
			how: "`open` is false.",
			appearance: "Nothing is rendered.",
		},
		{
			state: "Open, neutral",
			how: "`open` without `destructive`.",
			appearance: "Title without an icon; `outline` Cancel beside a `primary` confirm button.",
		},
		{
			state: "Open, destructive",
			how: "`destructive`.",
			appearance:
				"`feedback-error` warning icon before the title; `outline` Cancel beside a `destructive` confirm button.",
		},
		{
			state: "No description",
			how: "`description` omitted.",
			appearance: "Only the title above the buttons.",
		},
		{
			state: "Narrow window",
			how: "Below `sm`.",
			appearance: "The buttons stack, confirm on top of Cancel (DialogFooter).",
		},
		{
			state: "Busy, disabled",
			how: "—",
			appearance:
				"No distinct treatment: neither button can be disabled or show loading, and the dialog closes as soon as Confirm is pressed.",
		},
	],
	accessibility: [
		'`role="alertdialog"`, named by the title and described by the description through Dialog\'s `aria-labelledby` / `aria-describedby`.',
		"Cancel is first in DOM order, so it receives focus when the dialog opens; a stray Enter cancels instead of confirming.",
		"Focus is trapped while open; Escape and an overlay click dismiss like Cancel.",
		"ConfirmDialog has no trigger, so after it closes focus lands on the document body. Pass `onClosedAutoFocus` to put it back on the button, row or menu trigger it came from.",
		"The warning icon is decoration; the title and the confirm label must say what is destructive.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action: "Moves between Cancel and Confirm, wrapping inside the dialog.",
		},
		{
			keys: "Enter / Space",
			action: "Activates the focused button — Cancel when the dialog opens.",
		},
		{ keys: "Escape", action: "Closes without confirming." },
	],
	rules: [
		{
			id: "CFD-1",
			text: "Every modal yes/no in the app is a ConfirmDialog; do not assemble one from Dialog parts. When the question belongs to a control that stays on screen, use ConfirmPopover.",
		},
		{
			id: "CFD-2",
			text: "Set `destructive` only when confirming deletes, ends or revokes something (remove workspace, close a busy terminal, delete a remote branch, stop trusting). Closing a project, initialising a repo or pushing stays neutral.",
		},
		{
			id: "CFD-3",
			text: "Write the title as the question with its object (`Remove {name}?`) and pass a `confirmLabel` that repeats the verb; the default `Confirm` is a fallback, not a label.",
		},
		{
			id: "CFD-4",
			text: "Derive `open` from the pending target and clear the target in `onOpenChange`; read the target in `onConfirm` from that state, never from the row that opened it.",
		},
		{
			id: "CFD-5",
			text: "`onConfirm` starts the action and the dialog closes at once: no optimistic UI, let the result arrive and report failure with a toast. A confirm that must be disabled or show progress is a Dialog.",
		},
		{
			id: "CFD-6",
			text: "Restore focus with `onClosedAutoFocus` — ConfirmDialog has no trigger, so focus otherwise falls to the document body. Give the confirm button a `confirmTestId`.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Neutral",
			description:
				"Close a project: a `primary` confirm that repeats the verb; `onClosedAutoFocus` returns focus to the button.",
		},
		{
			id: "destructive",
			title: "Destructive",
			description: "A busy terminal's close: warning icon and a `destructive` Close anyway.",
		},
		{
			id: "rich-description",
			title: "Rich description",
			description: "`description` as a `<T>` element that emphasises the folder path.",
		},
		{
			id: "pending-target",
			title: "Pending target",
			description:
				"`open` is derived from the row waiting for confirmation; `onConfirm` acts on that state.",
		},
		{
			id: "from-menu",
			title: "Opened from a menu",
			description:
				"A dropdown item opens the confirmation; `onClosedAutoFocus` returns focus to the menu button.",
		},
		{
			id: "push",
			title: "Interpolated labels",
			description: "Title, plural description and confirm label all name the branch.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ProjectTree.tsx",
			note: "Close project (neutral) from the row menu, with `onClosedAutoFocus` restoring row focus.",
		},
		{
			file: "apps/web/src/panels/RemoveWorkspaceDialog.tsx",
			note: "Remove workspace: `destructive`, a `<T>` description emphasising the branch.",
		},
		{
			file: "apps/web/src/panels/McpSettings.tsx",
			note: "Remove an MCP server: `open={removing !== null}`, destructive `common.remove`.",
		},
		{
			file: "apps/web/src/panels/TerminalWorkbench.tsx",
			note: "Closing a terminal with a running process: destructive Close anyway.",
		},
		{
			file: "apps/web/src/panels/useShipRunner.tsx",
			note: "Push to the base branch (neutral) and delete the remote branch (destructive).",
		},
		{
			file: "apps/web/src/panels/useOpenProject.tsx",
			note: "Initialise a git repository before opening a folder (neutral).",
		},
	],
} satisfies ComponentDoc;
