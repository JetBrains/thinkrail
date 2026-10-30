import type { HeaderIconButton } from "@/panels/HeaderIconButton";
import type { ComponentDoc, PropDoc } from "../types";

type OwnProps = keyof Parameters<typeof HeaderIconButton>[0];

export const headerIconButton = {
	slug: "header-icon-button",
	name: "HeaderIconButton",
	group: "General",
	source: "apps/web/src/panels/HeaderIconButton.tsx",
	preview: "diff-header",
	tag: "<HeaderIconButton",
	importLine: 'import { HeaderIconButton } from "@/panels/HeaderIconButton";',
	summary:
		"The icon action of a panel header strip — the diff pane, the Changes review toolbar and walk bar, a review section header and the Files switch row. It is a thin wrapper that renders the shared IconButton fixed at `ghost` and `m`, and turns an optional `active` into the toggle contract (`selected`, `aria-pressed` and `data-active` together) and a required `testid` into `data-testid`. The call site provides the icon, the label, the handler and the strip around it; everything else (`tooltip`, `loading`, `tone`, `className`, other sizes and variants) is not exposed.",
	whenToUse: [
		"A one-click icon action in a pane or section header strip: Revert file, Copy file contents, Open as its own tab, Collapse all folders.",
		"An on/off header toggle with a familiar icon, such as Hide whitespace changes, with `active` driving `aria-pressed`.",
		"Previous / next stepping in a header bar, `disabled` at either end of the list.",
		"A pair of bulk actions such as Collapse all files / Expand all files beside the view toggles.",
	],
	alternatives: [
		{
			name: "IconButton",
			when: "The action needs anything HeaderIconButton does not pass: a `tooltip` that differs from the label, `loading` or `spinIcon`, `tone`, another size or variant, a `className`, or a Radix `asChild` trigger (the section menu beside these buttons is an IconButton).",
		},
		{
			name: "ToggleSegment",
			when: "The header chooses one of a few named views (Split | Inline, Stacked | One file) rather than turning one option on or off.",
		},
		{
			name: "Button",
			when: "The header action needs visible words to be understood, such as Mark as viewed in the review walk bar.",
		},
		{
			name: "AuxiliaryPaneHeader",
			when: "The whole header row of an auxiliary pane, with its title and close action, rather than one action inside a strip.",
		},
	],
	anatomy: [
		{
			part: "Button",
			description:
				'The shared IconButton at `variant="ghost"` and `size="m"`: a native `<button type="button">` square with `aria-label` set to `label`, `data-testid` from `testid`, and — only when `active` is passed — `aria-pressed` and `data-active`.',
		},
		{
			part: "Icon",
			description:
				"`icon`, sized by the button and `aria-hidden`. A tinted glyph (a success check) comes from `withIconClass`.",
		},
		{
			part: "Selected fill",
			description:
				"While `active` is true, the ghost selected role (`control-bg-selected`) through IconButton's `selected`.",
		},
		{
			part: "Focus ring",
			description:
				"IconButton's ghost icon-only ring, drawn inside the square so a clipped header strip keeps it.",
		},
		{
			part: "Tooltip",
			description:
				"Always the `label`, through the shared IconTooltip; it still opens while the button is disabled.",
		},
		{
			part: "Strip (call site)",
			description:
				'The component renders no strip. Call sites place it in a header row with a small flex gap, usually a `role="toolbar"` with an `aria-label`.',
		},
	],
	props: {
		testid: {
			type: "string",
			description:
				"Required. Rendered as `data-testid`; e2e tests select header actions by it (`diff-toggle-whitespace`, `changes-review-next`, `files-collapse-all`).",
		},
		label: {
			type: "string",
			description:
				"Required. The accessible name (`aria-label`) and the tooltip text. Use a locale key. There is no separate tooltip, so a shortcut hint is written into the label (`Previous file (Alt+↑)`).",
		},
		active: {
			type: "boolean",
			description:
				'Makes the button a toggle. `true` paints the selected fill (`selected`) and sets `aria-pressed="true"` and `data-active="true"`; `false` sets both to `"false"`. Omitted, neither attribute is rendered and the button is a plain action.',
		},
		disabled: {
			type: "boolean",
			default: "false",
			description:
				"Native `disabled`: the disabled roles, out of the Tab order, activation blocked. The tooltip still opens on hover.",
		},
		onClick: {
			type: "() => void",
			description: "Required. Activation handler (pointer, Enter, Space). It receives no event.",
		},
		icon: {
			type: "ButtonIcon",
			description:
				"Required. The icon component (pass `RiParagraph`, not `<RiParagraph />`). Swap it for transient feedback, for example to a `withIconClass` success check after a copy.",
		},
	} satisfies Record<OwnProps, PropDoc>,
	states: [
		{
			state: "Default",
			how: "Rest, no `active`.",
			appearance: "Ghost: only the muted icon, no surface.",
		},
		{
			state: "Hover",
			how: "Pointer over the button.",
			appearance: "Ghost hover fill; the tooltip with the label opens after the shared delay.",
		},
		{ state: "Pressed", how: "Pointer down or Space held.", appearance: "Identical to hover." },
		{
			state: "Keyboard focus",
			how: "Tab to the button.",
			appearance: "Inset focus ring, the ghost hover fill and the tooltip.",
		},
		{
			state: "Off",
			how: "`active={false}`.",
			appearance: 'Same as default; `aria-pressed="false"` and `data-active="false"`.',
		},
		{
			state: "On",
			how: "`active={true}`.",
			appearance:
				'Ghost selected fill (`control-bg-selected`), distinct from hover; `aria-pressed="true"` and `data-active="true"`.',
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance:
				"The disabled icon colour in place, not hidden, and no hover feedback; the tooltip still opens on hover. With `active`, the selected fill stays under the disabled icon.",
		},
		{
			state: "Loading",
			how: "Not exposed.",
			appearance: "No distinct treatment; use IconButton with `loading` for an in-flight action.",
		},
	],
	accessibility: [
		'Renders IconButton, so it is a native `<button type="button">`; role, focus and activation come from the platform.',
		"`label` is the accessible name and the tooltip; the icon is `aria-hidden`.",
		"`active` maps to `aria-pressed`, so a toggle is announced as pressed or not pressed. Pass it as a boolean on every render of a toggle — omitting it when off removes `aria-pressed` and the button stops being a toggle.",
		"The tooltip cannot differ from the name, so any shortcut hint is part of the accessible name (`Next file (Alt+↓)`). The shortcut itself is handled by the pane, not by the button.",
		'Call sites group the buttons in a `role="toolbar"` with an `aria-label` (`Diff view mode`, `Changes review`, `Files view`) but add no roving focus: every button stays its own Tab stop.',
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action:
				"Moves focus to and from each button; the focus ring and tooltip appear. Disabled buttons are skipped.",
		},
		{ keys: "Enter / Space", action: "Activates; on a toggle the call site flips active." },
		{ keys: "Escape", action: "Closes the tooltip." },
	],
	rules: [
		{
			id: "HIB-1",
			text: "Use HeaderIconButton for icon actions and on/off toggles in panel header strips; anywhere else, or when you need `tooltip`, `loading`, `tone`, another size or a menu trigger, use IconButton directly.",
		},
		{
			id: "HIB-2",
			text: "For a toggle, always pass `active` as a boolean (`active={ignoreWhitespace}`). Leave it out only for one-shot actions; a missing `active` drops `aria-pressed` and `data-active`.",
		},
		{
			id: "HIB-3",
			text: "A toggle keeps one label that names the option (`Hide whitespace changes`); `active` carries the on/off state.",
		},
		{
			id: "HIB-4",
			text: "Give every instance a unique `testid` named `<surface>-<action>` (`diff-copy`, `changes-review-prev`) — tests select header actions by it.",
		},
		{
			id: "HIB-5",
			text: "Hide a header action only when its capability is missing (no hunk actions, no whitespace support); when it exists but cannot run right now, keep it in place with `disabled`.",
		},
		{
			id: "HIB-6",
			text: "The component takes no `className`: place it with the strip's flex gap or a placement wrapper (`ml-auto flex shrink-0`), never by restyling it.",
		},
		{
			id: "HIB-7",
			text: 'Show transient success by swapping `icon` for a module-scope `withIconClass(RiCheckLine, "text-feedback-success")` for a moment; the label stays the same.',
		},
	],
	examples: [
		{
			id: "diff-header",
			title: "Diff pane header",
			description: "Revert, the whitespace toggle and copy in one toolbar, as in the diff pane.",
		},
		{
			id: "toggle",
			title: "Toggle",
			description: "`active` drives the selected fill, `aria-pressed` and `data-active`.",
		},
		{
			id: "copy-feedback",
			title: "Copy feedback",
			description: "The icon swaps to a success check for a moment after copying.",
		},
		{
			id: "file-walk",
			title: "Previous and next",
			description:
				"The review walk bar: each end disables its button, and the tooltip still opens.",
		},
		{
			id: "collapse-expand",
			title: "Collapse and expand all",
			description: "A pair of bulk actions in the stacked review toolbar.",
		},
		{
			id: "placement",
			title: "Placement",
			description:
				"No `className`: a placement wrapper pushes Collapse all folders to the end of the Files switch row.",
		},
		{
			id: "with-menu",
			title: "Beside a menu trigger",
			description:
				"A review section header: two HeaderIconButtons and an IconButton as the menu trigger, because HeaderIconButton cannot be an `asChild` trigger.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/DiffPane.tsx",
			note: "Revert file, the Hide whitespace toggle and Copy file contents with a success-check swap.",
		},
		{
			file: "apps/web/src/panels/ChangesReviewPane.tsx",
			note: "Collapse / Expand all, the guide and whitespace toggles, and Previous / Next file with `disabled` at the ends.",
		},
		{
			file: "apps/web/src/panels/ChangesFileSection.tsx",
			note: "Revert file and Open as its own tab beside the IconButton menu trigger.",
		},
		{
			file: "apps/web/src/panels/FilesPanel.tsx",
			note: "Collapse all folders at the end of the All | Changed row.",
		},
	],
} satisfies ComponentDoc;
