import type { ComponentProps, HTMLAttributes } from "react";
import type { FileChip } from "@/chat/FileChip";
import type { ComponentDoc, PropDoc } from "../types";

type FileChipProps = ComponentProps<typeof FileChip>;
type OwnProps = Exclude<
	keyof FileChipProps,
	Exclude<keyof HTMLAttributes<HTMLElement>, "onClick"> | `data-${string}`
>;

const toneNote =
	"`tone` sets the chip's border, fill and text together; the trailing action keeps its own colours.";

export const fileChip = {
	slug: "file-chip",
	name: "FileChip",
	group: "Data display",
	source: "apps/web/src/chat/FileChip.tsx",
	preview: "preview",
	tag: "<FileChip",
	importLine: 'import { FileChip } from "@/chat/FileChip";',
	summary:
		"A compact, bounded chip for one file or attachment: a file icon, a truncating label, an optional `meta` suffix and an optional trailing action. It owns its border, fill, padding, type and the `default` / `error` tones, and becomes a `<button>` when given `onClick`. The call site provides the label, the suffix that must stay readable, and any action.",
	whenToUse: [
		"An image attached to the composer or the new-workspace prompt, with its `· W×H` size and a Remove action.",
		"An attachment shown in a sent message, opening a preview when clicked.",
		'An attach failure in the attachment strip — the file name plus the reason, dismissible (`tone="error"`, no icon).',
		"A placeholder while files are still decoding (“Attaching 2…”), or a one-line command error in the composer's chip row.",
	],
	alternatives: [
		{
			name: "DiffStatBadge",
			when: "Only the line counts of a changed file are shown, inside its row.",
		},
		{
			name: "TreeRow",
			when: "A file in a navigable list or tree (Changes, Files) rather than a single attachment.",
		},
		{
			name: "SettingsNotice",
			when: "An error or notice that needs a sentence and actions, not a chip-sized line.",
		},
		{
			name: "Toast",
			when: "A transient error that is not tied to an attachment the user can see and dismiss.",
		},
	],
	anatomy: [
		{
			part: "Container",
			description:
				'A `<span>`, or a `<button type="button">` when `onClick` is set: `max-w-full` flex row with a `rounded-sm` border, `px-8 py-4` and `tr-text-metadata`; the tone sets border, fill and text colour.',
		},
		{
			part: "Icon",
			description: "`RiFileLine` at `size-12`, never shrinks. Omitted with `icon={false}`.",
		},
		{
			part: "Label",
			description: "`label` in a `min-w-0 truncate` span — the only part that gives way.",
		},
		{
			part: "Meta",
			description:
				"Optional `meta`, never shrinks: the text that must stay readable at any width (the image size, an error's reason).",
		},
		{
			part: "Trailing",
			description:
				"Optional `trailing`, a non-shrinking flex slot for one action (Remove, Dismiss).",
		},
	],
	props: {
		label: {
			type: "ReactNode",
			description:
				"The file name or message. Truncates with an ellipsis; pair a long, user-controlled name with `title`.",
		},
		meta: {
			type: "ReactNode",
			description:
				"A suffix after the label that never truncates. Include its own separator, as in `· 1280×720` or `— unsupported image format`.",
		},
		trailing: {
			type: "ReactNode",
			description:
				"One trailing action, usually an `IconButton` at size `s`. Only on a static chip — a chip with `onClick` is already a button.",
		},
		onClick: {
			type: "() => void",
			description:
				"Makes the chip a `<button>` with a hover fill and a focus ring, for opening the file. Give it an `aria-label`.",
		},
		tone: {
			type: '"default" | "error"',
			default: '"default"',
			description:
				"`default`: neutral elevated fill and default text. `error`: error-muted border, error-subtle fill and error text.",
		},
		icon: {
			type: "boolean",
			default: "true",
			description: "Shows the leading file icon. Error and command chips pass `false`.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	nativeProps: {
		title: "Passed-through attributes",
		props: {
			title: {
				type: "string",
				description:
					"Native hover text for the full label (or the full error) when it truncates. Spread onto the chip element.",
			},
			"aria-label": {
				type: "string",
				description:
					"Accessible name for a clickable chip, from a locale key (`chat.turn.viewAttachment`).",
			},
			"data-testid": { type: "string", description: "Test hook, spread onto the chip element." },
			"data-width": {
				type: "number | undefined",
				description: "Image width hook for e2e (`composer-image` chips).",
			},
			"data-height": {
				type: "number | undefined",
				description: "Image height hook for e2e.",
			},
			"data-mime": {
				type: "string | undefined",
				description: "Image MIME type hook for e2e.",
			},
		} satisfies Record<Exclude<keyof FileChipProps, OwnProps>, PropDoc>,
	},
	tones: {
		note: toneNote,
		docs: {
			default:
				"Every file or attachment — composer images, sent attachments and the pending placeholder.",
			error:
				"A refused attachment or a failed command in the composer's chip row, with the icon off.",
		} satisfies Record<NonNullable<FileChipProps["tone"]>, string>,
	},
	sections: [
		{ id: "tone", title: "Tone", description: toneNote },
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Hover the clickable chip, or click into the page and press Tab to see its focus ring.",
		},
	],
	states: [
		{
			state: "Static",
			how: "No `onClick`.",
			appearance:
				"A `<span>`; no hover or focus treatment. Its trailing action has its own states.",
		},
		{
			state: "Hover",
			how: "Pointer over a chip with `onClick`.",
			appearance: "`bg-control-bg-hovered` fill, with a colour transition.",
		},
		{
			state: "Keyboard focus",
			how: "Tab to a chip with `onClick`.",
			appearance:
				"`ring-2` in `primary` around the chip. The chip does not set `outline-none`, so the browser's own focus outline also shows inside the ring.",
		},
		{
			state: "Error",
			how: '`tone="error"`.',
			appearance:
				"Error-muted border, error-subtle fill and error text. Production error chips are static, so they have no hover change.",
		},
		{
			state: "Truncated",
			how: "The label is wider than the space available.",
			appearance:
				"The label ends in an ellipsis; icon, `meta` and `trailing` keep their full width.",
		},
		{
			state: "Pending",
			how: "The call site passes a muted label (“Attaching 2…”).",
			appearance: "No distinct treatment from the chip itself; the label carries the muted colour.",
		},
		{
			state: "Selected, disabled, loading",
			how: "—",
			appearance: "No distinct treatment; the chip has no such props.",
		},
	],
	accessibility: [
		'Static chips are plain text; with `onClick` the chip is a native `<button type="button">`, so focus and activation come from the platform.',
		"A clickable chip needs an `aria-label` that names the action and the file (`chat.turn.viewAttachment`), since the visible label is only the file name.",
		"`title` is native hover text only — it does not reach touch or keyboard users. Anything the user must read on a phone goes in `meta`, which never truncates.",
		"The trailing action carries its own accessible name (an IconButton `label` such as `chat.promptImages.remove`).",
		"The file icon is decorative and carries no label.",
		"A clickable chip opens its Dialog from `onClick`, not through a `DialogTrigger`, so on close Radix has no trigger to return focus to and focus falls to the document body (as in `turns.tsx`'s `AttachmentChip`).",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action: "Reaches a clickable chip, or the trailing action of a static chip.",
		},
		{ keys: "Enter / Space", action: "Activates a clickable chip (opens the attachment)." },
	],
	rules: [
		{
			id: "FCH-1",
			text: "Every attachment, image or file token in the composer and transcript is a FileChip — composer images, sent attachments, attach errors and the pending placeholder share the one skin.",
		},
		{
			id: "FCH-2",
			text: "Put what must stay readable in `meta`, not `label`: the `· W×H` size and an error's reason. The label is the only part that truncates; the file name gives way first.",
		},
		{
			id: "FCH-3",
			text: 'Errors are `tone="error"` with `icon={false}`, the file name in `label`, the reason in `meta` and the full sentence in `title` — never a colour class.',
		},
		{
			id: "FCH-4",
			text: "A chip is either clickable (`onClick` + `aria-label`) or carries one `trailing` action — never both, which would nest a button in a button.",
		},
		{
			id: "FCH-5",
			text: "Trailing actions are an `IconButton` at size `s` with a locale-key `label` (Remove image, Dismiss).",
		},
		{
			id: "FCH-6",
			text: "Keep the chip bounded: place chips in a `flex flex-wrap gap-4` strip and do not override `max-w-full` or the label's truncation; filenames are user-controlled.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Attached image",
			description: "A composer image with its size in `meta` and a Remove action.",
		},
		{
			id: "attachment-strip",
			title: "Attachment strip",
			description:
				"The composer's chip row: an attach error, images and the pending placeholder. Remove and dismiss work.",
		},
		{
			id: "error",
			title: "Attach error",
			description:
				'`tone="error"` without the icon: the name truncates, the reason in `meta` stays, the full sentence is the `title`.',
		},
		{
			id: "pending",
			title: "Pending",
			description: "The placeholder while images are still decoding; sends wait for it.",
		},
		{
			id: "attachment",
			title: "Clickable attachment",
			description:
				"A sent message's attachment: `onClick` makes the chip a button that opens the image in a Dialog.",
		},
		{
			id: "command-error",
			title: "Command error",
			description: "A failed slash command in the composer's chip row — label only, no icon.",
		},
		{
			id: "truncation",
			title: "Long file name",
			description:
				"In a narrow column the label truncates while the icon, `meta` and the Remove action keep their width.",
		},
	],
	usages: [
		{
			file: "apps/web/src/chat/promptImages.tsx",
			note: "`PromptImageChips`: attach errors, image chips with size and Remove, and the pending placeholder.",
		},
		{
			file: "apps/web/src/chat/turns.tsx",
			note: "`AttachmentChip`: a clickable chip in a sent message that opens the image in a Dialog.",
		},
		{
			file: "apps/web/src/chat/Composer.tsx",
			note: "The command-submit error chip, passed as the strip's `leading` chip.",
		},
	],
} satisfies ComponentDoc;
