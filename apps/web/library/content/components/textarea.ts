import type { Textarea } from "@thinkrail/ui/textarea";
import type { ComponentProps, TextareaHTMLAttributes } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type TextareaProps = ComponentProps<typeof Textarea>;
type OwnProps = Exclude<
	keyof TextareaProps,
	keyof TextareaHTMLAttributes<HTMLTextAreaElement> | "key"
>;

export const textarea = {
	slug: "textarea",
	name: "Textarea",
	group: "Data entry",
	source: "packages/ui/textarea.tsx",
	preview: "preview",
	tag: "<Textarea",
	importLine: 'import { Textarea } from "@thinkrail/ui/textarea";',
	summary:
		"The shared multi-line text field for dialogs and forms: a native `<textarea>` with the control border and fill, `tr-text-ui` type, a muted placeholder, a stronger border while focused and the disabled roles. It adds no props of its own — the call site provides the label, `value`/`onChange`, `rows`, any key handling and placement.",
	whenToUse: [
		"A multi-line plain-text value in a dialog or form: a prompt template body, a new workspace prompt, a pull request description.",
		"Code-like text the user edits line by line — MCP server arguments, pasted `mcpServers` JSON, an entry's raw JSON — with `tr-code-text`.",
		"A field whose Enter key submits the dialog while Shift+Enter inserts a newline, as the new workspace prompt does.",
		"A field that fills the remaining height of a dialog column (`flex-1` with a `min-h-*`).",
	],
	alternatives: [
		{
			name: "Native `<input>`",
			when: "The value is a single line — a name, a URL, a command. Dialogs style those with their own input class.",
		},
		{
			name: "SettingsRadioCards",
			when: "The user picks one of a few fixed, described options instead of typing.",
		},
		{
			name: "SegmentedControl",
			when: "The value is one of a few short presets.",
		},
		{
			name: "Command",
			when: "Typing filters a list the user then picks from (a branch, a session, a model).",
		},
	],
	anatomy: [
		{
			part: "Field",
			description:
				"A native `<textarea>`: `w-full`, `rounded-sm`, a `control-border-default` border on `control-bg`, `px-12 py-8` padding and `tr-text-ui` in `text-default`. `resize-none` unless the call site opts in.",
		},
		{
			part: "Placeholder",
			description:
				"The native placeholder in `text-muted`. An example of the content, not the label.",
		},
		{
			part: "Label (call site)",
			description:
				"The component renders none. Production pairs it with a `<label htmlFor>` above it, or relies on the dialog's own heading.",
		},
		{
			part: "Hint or error (call site)",
			description:
				'A `tr-text-metadata` line under the field: a muted hint, or an error in `text-feedback-error` with `role="alert"`.',
		},
	],
	props: {
		ref: {
			type: "Ref<HTMLTextAreaElement>",
			description:
				"Forwarded to the `<textarea>` (React 19 ref prop) — the new workspace prompt uses it to focus the field and place the selection after a template is applied.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	nativeProps: {
		title: "Native textarea props",
		props: {
			value: {
				type: "string",
				description: "Controlled value. Every production call site is controlled.",
			},
			onChange: {
				type: "ChangeEventHandler<HTMLTextAreaElement>",
				description:
					"Receives every edit; read `event.target.value` or `event.currentTarget.value`.",
			},
			rows: {
				type: "number",
				description:
					"Visible height in lines. The field does not grow with its content; production uses 3 for arguments, 6 to 8 for prompts and JSON, 12 to 14 for raw entries and PR descriptions.",
			},
			placeholder: {
				type: "string",
				description: "Example content in `text-muted`. Use a locale key, or a literal code sample.",
			},
			disabled: {
				type: "boolean",
				description:
					"Native disabled: the disabled border, fill and text roles, not focusable. Set it while the owning action runs.",
			},
			readOnly: {
				type: "boolean",
				description: "Native read-only; focusable and selectable. No distinct look.",
			},
			spellCheck: {
				type: "boolean",
				description:
					"Production turns it off (`false`) for prompts and template bodies, which are full of code and file names.",
			},
			onKeyDown: {
				type: "KeyboardEventHandler<HTMLTextAreaElement>",
				description:
					"Call-site shortcuts, such as Enter to submit. Check IME composition first (`isPromptKeyEventComposing`).",
			},
			id: {
				type: "string",
				description: "Ties the field to a `<label htmlFor>`.",
			},
			"aria-label": {
				type: "string",
				description: "The accessible name when no visible label is tied to the field.",
			},
			className: {
				type: "string",
				description:
					"Placement and height (`min-h-*`, `flex-1`), `resize-y` for a field the user may stretch, and `tr-code-text` (with `px-8 py-4`) for code-like content. Merged after the base classes.",
			},
		} satisfies Partial<Record<keyof TextareaProps, PropDoc>>,
	},
	states: [
		{
			state: "Empty",
			how: "`value` is empty.",
			appearance: "The placeholder in `text-muted` on `control-bg`.",
		},
		{
			state: "Filled",
			how: "`value` has text.",
			appearance: "`tr-text-ui` in `text-default`; overflow scrolls inside the field.",
		},
		{
			state: "Hover",
			how: "Pointer over the field.",
			appearance: "No distinct treatment.",
		},
		{
			state: "Focus",
			how: "Click or Tab into the field.",
			appearance:
				"The border changes to `control-border-active`. The native outline is removed (`outline-none`) and there is no accent ring.",
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance:
				"`control-disabled-border`, `control-disabled-bg` and `control-disabled-text`; the placeholder stays `text-muted`. Not focusable.",
		},
		{
			state: "Read-only",
			how: "`readOnly`.",
			appearance: "No distinct treatment; it still takes the focus border.",
		},
		{
			state: "Error",
			how: "The call site's validation fails.",
			appearance:
				'No distinct treatment on the field; the call site shows a `role="alert"` message below it.',
		},
	],
	accessibility: [
		"A native `<textarea>`: an implicit multi-line textbox, with focus, selection, undo and IME input from the platform.",
		"It has no accessible name of its own. Tie it to a visible `<label htmlFor>` (template body, PR description) or give it `aria-label`; a placeholder is not a label.",
		"The focus indicator is the `control-border-active` border, not a ring.",
		"`disabled` removes it from the tab order; use `readOnly` when the text must stay selectable.",
		'Errors are announced by the call site\'s `role="alert"` line; the field sets neither `aria-invalid` nor `aria-describedby`.',
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves focus to and from the field." },
		{
			keys: "Enter / Shift+Enter",
			action: "Insert a newline, unless the call site's `onKeyDown` handles Enter.",
		},
		{
			keys: "Arrows, Home, End",
			action: "Move the caret; native text editing.",
		},
	],
	rules: [
		{
			id: "TXA-1",
			text: "Use Textarea for multi-line fields in dialogs and forms. The chat composer, `PlanComposer` and `ReviewComposer` own their own editors; do not rebuild them from Textarea or copy their classes onto it.",
		},
		{
			id: "TXA-2",
			text: "Name every Textarea: a visible `<label htmlFor>` tied to its `id`, or `aria-label` when a heading already names it. The placeholder only shows example content.",
		},
		{
			id: "TXA-3",
			text: "Size it with `rows`, or with `flex-1` and a `min-h-*` inside a flex column. It never grows with its content. It does not resize by default; add `resize-y` only where stretching helps, as on the PR description.",
		},
		{
			id: "TXA-4",
			text: "`className` is for placement, height and resize. Border, fill, focus and disabled come from the component. The one font change in production is `tr-code-text` (with `px-8 py-4` in the MCP dialogs) for code-like content.",
		},
		{
			id: "TXA-5",
			text: "Disable the field with native `disabled` while its action runs (saving a template, creating a workspace, generating a PR body). Never dim it with opacity.",
		},
		{
			id: "TXA-6",
			text: 'Show validation as a `role="alert"` line in `text-feedback-error tr-text-metadata` under the field; do not recolour the field\'s border.',
		},
		{
			id: "TXA-7",
			text: "An Enter shortcut returns early while an IME composition is active (`isPromptKeyEventComposing`) and leaves Shift+Enter as a newline.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Basic",
			description: "A controlled field with an accessible name and a placeholder.",
		},
		{
			id: "labelled",
			title: "Labelled field with a hint",
			description: "The template editor's body: a `<label htmlFor>`, eight rows and a syntax hint.",
		},
		{
			id: "code",
			title: "Code-like content",
			description: "MCP server arguments, one per line, in `tr-code-text`.",
		},
		{
			id: "json-validation",
			title: "Validation message",
			description:
				'Pasted `mcpServers` JSON parsed with the real parser; the error is a `role="alert"` line, not a field style.',
		},
		{
			id: "disabled",
			title: "Disabled while saving",
			description: "The field takes the disabled roles while its Save action is loading.",
		},
		{
			id: "enter-submits",
			title: "Enter submits",
			description:
				"The new workspace prompt: Enter submits outside an IME composition, Shift+Enter adds a line. The counter shows submissions.",
		},
		{
			id: "fill-column",
			title: "Fills its column",
			description:
				"The PR description takes the column's remaining height with `flex-1` and can be stretched with `resize-y`.",
		},
	],
	usages: [
		{
			file: "apps/web/src/chat/TemplateEditorDialog.tsx",
			note: "The template body: labelled, eight rows, disabled while loading, with a syntax hint.",
		},
		{
			file: "apps/web/src/panels/McpServerDialogs.tsx",
			note: "Arguments, `mcpServers` JSON import and raw entry editing in `tr-code-text`, with alert errors.",
		},
		{
			file: "apps/web/src/panels/NewWorkspaceDialog.tsx",
			note: "The workspace prompt: `ref`, Enter to create, template slots, image paste and drop.",
		},
		{
			file: "apps/web/src/panels/PrComposeDialog.tsx",
			note: "The PR description filling the dialog with `flex-1 resize-y`, disabled while generating.",
		},
	],
} satisfies ComponentDoc;
