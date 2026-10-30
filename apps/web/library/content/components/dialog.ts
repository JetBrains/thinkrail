import type { Dialog, DialogContent, DialogPanel } from "@thinkrail/ui/dialog";
import type { ComponentProps } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type RootProps = ComponentProps<typeof Dialog>;
/** `DialogPanel` takes exactly Radix `Dialog.Content` props, so the difference is what ThinkRail adds. */
type RadixContentProps = ComponentProps<typeof DialogPanel>;
type ContentOwnProps = Exclude<keyof ComponentProps<typeof DialogContent>, keyof RadixContentProps>;

export const dialog = {
	slug: "dialog",
	name: "Dialog",
	group: "Overlay",
	source: "packages/ui/dialog.tsx",
	preview: "preview",
	tag: "<DialogContent",
	importLine:
		'import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@thinkrail/ui/dialog";',
	summary:
		"The modal surface for a focused task or decision: Radix Dialog with ThinkRail's overlay, a centred elevated card, header, footer, title and description parts and a Close icon button. It owns the portal, the overlay, focus trapping and return, scroll lock, Escape and outside-click dismissal and the title and description type; the call site provides the open state, the content, the actions and the width. `DialogPanel` is the non-modal, in-place variant, and `useModalLayerOpen()` tells any surface whether a modal dialog covers it.",
	whenToUse: [
		"A short task that must be finished or cancelled before going back: a form (new template, clone repository, open a host path), a login, a merge.",
		"A larger view of something already on screen: a tool's full output, an image attachment at full size.",
		"A decision that needs more than yes/no — extra fields, a live count, a gated confirm button (Stop all subagents).",
		"A caller-positioned, non-modal panel that still needs dialog semantics, Escape and focus return — `DialogPanel` in `<Dialog modal={false}>` (the Resources inspector).",
		"Knowing that a modal covers your surface — `useModalLayerOpen()` (the chat transcript holds completion acknowledgement while one is open).",
	],
	alternatives: [
		{
			name: "ConfirmDialog",
			when: "A plain yes/no with a title, a description, Cancel and one confirm button. Do not rebuild it from Dialog parts.",
		},
		{
			name: "ConfirmPopover",
			when: "A yes/no anchored to the dedicated control that asked for it.",
		},
		{
			name: "Popover",
			when: "Light, non-blocking content next to its trigger; the rest of the page stays usable.",
		},
		{
			name: "Toast",
			when: "Reporting a result that needs no decision.",
		},
	],
	anatomy: [
		{
			part: "Dialog",
			description:
				"Radix `Root`. Holds the open state (`open` + `onOpenChange`, or `defaultOpen`); renders nothing itself.",
		},
		{
			part: "DialogTrigger",
			description:
				"Radix `Trigger`. Use `asChild` on a Button or IconButton; it gets `aria-haspopup`, `aria-expanded`, `aria-controls` and `data-state`, and focus returns to it on close.",
		},
		{
			part: "Overlay",
			description:
				'Rendered by DialogContent: a fixed, full-window `bg-overlay` layer at `z-50` with `data-modal-layer` and `data-testid="dialog-overlay"`. A click on it dismisses the dialog.',
		},
		{
			part: "DialogContent",
			description:
				"Portalled to `document.body` and centred in the window: a `rounded-lg` card with a `border-default` border on `container-elevated-bg`, the large shadow, `p-16`, its children stacked with `gap-16`, `w-full` up to `max-w-[28rem]`.",
		},
		{
			part: "Close button",
			description:
				"An IconButton (ghost, M, `RiCloseLine`, label `common.close`) at `top-12 right-12` inside the card, wrapped in Radix `Close`. Rendered last, after the children. Omitted with `hideClose`.",
		},
		{
			part: "DialogHeader",
			description: "A `div` stacking the title and description with `gap-4`.",
		},
		{
			part: "DialogTitle",
			description:
				"Radix `Title`, an `h2` in `tr-title-dialog` and `text-default`. The dialog's accessible name.",
		},
		{
			part: "DialogDescription",
			description:
				"Radix `Description`, a `p` in `tr-text-ui` and `text-muted`. Referenced by the dialog's `aria-describedby`.",
		},
		{
			part: "DialogFooter",
			description:
				"A `div` for the actions: stacked in reverse order (`flex-col-reverse`, `gap-8`) under `sm`, a right-aligned row from `sm`. Put the dismiss action first and the main action last.",
		},
		{
			part: "DialogClose",
			description:
				"Radix `Close`. `asChild` on a Button closes an uncontrolled dialog through `onOpenChange(false)`.",
		},
		{
			part: "DialogPanel",
			description:
				"Radix `Content` rendered in place — no portal, overlay or Close button — with the elevated background, the default border colour (the caller sets which sides) and no outline. The caller positions it.",
		},
		{
			part: "useModalLayerOpen()",
			description:
				'A hook returning `true` while any `[data-modal-layer][data-state="open"]` element is in the document — a DialogContent overlay. It observes `document.body`; on the server it returns `false`.',
		},
	],
	props: {
		hideClose: {
			type: "boolean",
			default: "false",
			description:
				"`DialogContent` only. Omits the built-in Close button, for content that owns its dismissal: a confirmation or notice whose footer decides, a command palette, or `hideClose={busy}` while an operation must not be abandoned (with `onOpenChange` ignoring the close too).",
		},
	} satisfies Record<ContentOwnProps, PropDoc>,
	nativeProps: {
		title: "Radix props in common use (passed through unchanged)",
		props: {
			open: {
				type: "boolean",
				description: "`Dialog`. Controlled open state — the usual form in the app.",
			},
			defaultOpen: {
				type: "boolean",
				default: "false",
				description: "`Dialog`. Initial state of an uncontrolled dialog opened by a DialogTrigger.",
			},
			onOpenChange: {
				type: "(open: boolean) => void",
				description:
					"`Dialog`. Called by the trigger, every Close, Escape and an overlay click. Clear the state that opened the dialog here; ignore `false` to keep a busy dialog open.",
			},
			modal: {
				type: "boolean",
				default: "true",
				description:
					"`Dialog`. `false` only with DialogPanel: no focus trap, no scroll lock, the page stays interactive.",
			},
			onOpenAutoFocus: {
				type: "(event: Event) => void",
				description:
					"`DialogContent` / `DialogPanel`. By default focus moves to the first focusable element, or to an element with `autoFocus`. Call `event.preventDefault()` and focus something else (the session switcher's command list, the inspector's selected row).",
			},
			onCloseAutoFocus: {
				type: "(event: Event) => void",
				description:
					"`DialogContent` / `DialogPanel`. By default focus returns to the DialogTrigger; without one it lands on the document body. Call `event.preventDefault()` and focus the element the dialog came from.",
			},
			onEscapeKeyDown: {
				type: "(event: KeyboardEvent) => void",
				description: "`DialogContent` / `DialogPanel`. `preventDefault()` keeps the dialog open.",
			},
			onInteractOutside: {
				type: "(event: Event) => void",
				description:
					"`DialogContent` / `DialogPanel`. Pointer down or focus outside; `preventDefault()` keeps it open (the Resources inspector panel does).",
			},
			role: {
				type: "AriaRole",
				default: '"dialog"',
				description: '`DialogContent`. `"alertdialog"` for a confirmation (ConfirmDialog sets it).',
			},
			"aria-describedby": {
				type: "string | undefined",
				description:
					"`DialogContent` / `DialogPanel`. Radix points it at the DialogDescription; pass `undefined` when the dialog has none.",
			},
			className: {
				type: "string",
				description:
					"Size and layout only: width (`max-w-*`), a height cap with overflow, `gap-12`, or `p-0 gap-0` for chromeless content. Never colour, border, radius, shadow or type.",
			},
			asChild: {
				type: "boolean",
				description: "`DialogTrigger` / `DialogClose`. Merge onto the child Button or IconButton.",
			},
		} satisfies Partial<Record<keyof RootProps | keyof RadixContentProps, PropDoc>>,
	},
	states: [
		{
			state: "Closed",
			how: "`open` is false.",
			appearance:
				'Nothing is rendered; the content unmounts, so local field state resets unless the caller keeps it. The trigger has `data-state="closed"`.',
		},
		{
			state: "Open (modal)",
			how: "`open`, a DialogTrigger, or `defaultOpen`.",
			appearance:
				"`bg-overlay` dims the whole window, the card sits centred above it, page scroll is locked and everything outside is hidden from assistive tech. Opens and closes without a transition. A Button or IconButton trigger shows its selected look under the overlay.",
		},
		{
			state: "Without Close button",
			how: "`hideClose`.",
			appearance: "No corner button; the footer, Escape and the overlay dismiss.",
		},
		{
			state: "Close button hover / focus",
			how: "Pointer over the Close button, or Tab to it.",
			appearance:
				"The IconButton's own ghost hover and focus ring; its `common.close` tooltip on hover and keyboard-visible focus — not when it is autofocused after a pointer open.",
		},
		{
			state: "Non-modal panel",
			how: "`DialogPanel` inside `<Dialog modal={false}>`.",
			appearance:
				"No overlay and no Close button; the panel sits where the caller placed it and the page around it stays interactive.",
		},
		{
			state: "Busy, loading, error",
			how: "—",
			appearance:
				"No distinct treatment: the content shows its own status or error line and the footer buttons take `disabled` or `loading`.",
		},
	],
	accessibility: [
		'DialogContent renders `role="dialog"` with `aria-labelledby` pointing at DialogTitle and `aria-describedby` at DialogDescription. Every dialog needs a DialogTitle; without a description pass `aria-describedby={undefined}`.',
		"A modal dialog traps Tab inside the card, locks page scroll and sets `aria-hidden` on everything outside it.",
		"On open, focus moves to the first focusable element in DOM order (the Close button comes last), or to an element with `autoFocus`.",
		"On close, focus returns to the DialogTrigger. A dialog opened without one — from a plain button, a menu item or a store flag — sends focus to the document body; return it in `onCloseAutoFocus`.",
		"The Close button is an IconButton labelled `common.close`; with `hideClose`, a footer button must offer the way out.",
		"DialogPanel keeps the dialog role, title, Escape and focus return but does not trap focus or hide the page.",
		"`useModalLayerOpen()` counts only modal DialogContent overlays; it does not depend on how `aria-hidden` treats live regions.",
	],
	keyboard: [
		{ keys: "Enter / Space", action: "On a DialogTrigger: opens the dialog." },
		{
			keys: "Tab / Shift+Tab",
			action: "Moves through the dialog's controls and wraps at the ends (modal only).",
		},
		{
			keys: "Escape",
			action:
				"Closes the dialog through onOpenChange(false). An open tooltip inside closes in the same press.",
		},
		{
			keys: "Enter",
			action: 'In a form inside the dialog: submits it (a `type="submit"` Button).',
		},
	],
	rules: [
		{
			id: "DLG-1",
			text: "Use a modal Dialog only for a task or decision that must be finished before going on. A plain yes/no is a ConfirmDialog; anything anchored to its control is a Popover or ConfirmPopover.",
		},
		{
			id: "DLG-2",
			text: "Every dialog has a DialogTitle, and a DialogDescription when it has a sentence of context. With no description, pass `aria-describedby={undefined}`.",
		},
		{
			id: "DLG-3",
			text: "Build the body from DialogHeader and DialogFooter. In the footer the dismiss action comes first and the main action last, at the Button default size; one `primary` per dialog (BTN-1).",
		},
		{
			id: "DLG-4",
			text: "`className` on DialogContent sets size and layout only — `max-w-*`, a height cap with `overflow-y-auto`, `gap-12`, `p-0 gap-0` for chromeless content. Never colour, border, radius, shadow or type.",
		},
		{
			id: "DLG-5",
			text: "Keep the Close button unless the content owns dismissal: `hideClose` for confirmation and notice footers, command palettes, and `hideClose={busy}` while an operation must not be abandoned. With the button, keep the header text clear of it (`pr-24` on DialogHeader).",
		},
		{
			id: "DLG-6",
			text: "Open from `DialogTrigger asChild` whenever a control opens the dialog, also for a controlled `open`, so focus comes back to it. A dialog opened without a trigger returns focus itself in `onCloseAutoFocus`; otherwise focus falls to the document body.",
		},
		{
			id: "DLG-7",
			text: "`DialogPanel` is only for a caller-positioned, non-modal panel inside `<Dialog modal={false}>`. It is not a way to restyle a modal.",
		},
		{
			id: "DLG-8",
			text: "To know whether a modal covers a surface, call `useModalLayerOpen()`; never keep a registry of open dialogs.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Basic",
			description:
				"A DialogTrigger, a header with title and description, and a footer of DialogClose buttons.",
		},
		{
			id: "form",
			title: "Form",
			description:
				"A controlled dialog with a DialogTrigger around a form: the field takes `autoFocus`, Save submits and stays disabled until there is input.",
		},
		{
			id: "hide-close",
			title: "Notice without a Close button",
			description: "`hideClose`: the single footer action is the way out, as in the Notice Dialog.",
		},
		{
			id: "busy",
			title: "Not closable while busy",
			description:
				"`hideClose={busy}` and an `onOpenChange` that ignores closing while the clone runs; Cancel stops the operation first.",
		},
		{
			id: "large-content",
			title: "Large content",
			description:
				"A wider card with a height cap and a scrolling body; the header keeps clear of the Close button.",
		},
		{
			id: "return-focus",
			title: "Return focus without a trigger",
			description:
				"A controlled dialog opened from a plain Button returns focus to it in `onCloseAutoFocus`.",
		},
		{
			id: "panel",
			title: "Non-modal panel",
			description:
				"`DialogPanel` in `<Dialog modal={false}>`, placed over its own region; Escape or Close dismisses it and the page stays usable.",
		},
		{
			id: "modal-layer",
			title: "Covered by a modal",
			description: "`useModalLayerOpen()` turns true while any modal dialog is open.",
		},
	],
	usages: [
		{
			file: "apps/web/src/notifications/NotificationPermissionPrompt.tsx",
			note: "The canonical layout: header, description, Not now (outline) and Enable (primary) in the footer.",
		},
		{
			file: "apps/web/src/panels/CloneProjectDialog.tsx",
			note: "A form dialog with `hideClose={busy}` and an `onOpenChange` that ignores closing while cloning.",
		},
		{
			file: "apps/web/src/chat/tools/mcp/McpActions.tsx",
			note: "DialogTrigger on a text action; a wide, height-capped dialog with `pr-24` on the header.",
		},
		{
			file: "apps/web/src/shell/SessionSwitcher.tsx",
			note: "Chromeless: `hideClose`, `p-0 gap-0`, a Command inside and `onOpenAutoFocus` moving focus to it.",
		},
		{
			file: "apps/web/src/chat/ChatView.tsx",
			note: "Stop all subagents, opened without a trigger: `onCloseAutoFocus` returns focus to the Resources button or the composer.",
		},
		{
			file: "apps/web/src/panels/ConfirmDialog.tsx",
			note: 'ConfirmDialog: `role="alertdialog"`, `hideClose` and a narrower card.',
		},
	],
} satisfies ComponentDoc;
