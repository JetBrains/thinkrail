import type { IconButtonProps } from "@thinkrail/ui/button";
import type { ButtonHTMLAttributes } from "react";
import type { ComponentDoc, PropDoc } from "../types";
import { sharedPropDocs, sizeDocs, toneDocs, variantDocs } from "./button";

type OwnProps<P> = Exclude<keyof P, keyof ButtonHTMLAttributes<HTMLButtonElement>>;

export const iconButton = {
	slug: "icon-button",
	name: "IconButton",
	group: "General",
	source: "packages/ui/button.tsx",
	preview: "variants",
	tag: "<IconButton",
	importLine: 'import { IconButton } from "@thinkrail/ui/button";',
	summary:
		"A square, icon-only action. Its required `label` is both the accessible name and the shared tooltip, so an icon is never left unexplained. Same variants, sizes and states as Button; defaults to `ghost` at `m`.",
	whenToUse: [
		"Toolbar, header, tab and row actions where a familiar icon is clear: close, copy, more, add, refresh.",
		"Compact toggles in a header strip, with `selected` and `aria-pressed`.",
		"A menu trigger (`DropdownMenuTrigger asChild`), which shows the selected state while the menu is open.",
	],
	alternatives: [
		{
			name: "Button",
			when: "The action needs words to be understood, or it is the main action of a surface.",
		},
		{
			name: "Button with iconLeft",
			when: "An icon helps recognition but the label must stay visible.",
		},
		{ name: "ToggleSegment", when: "Switching between a few named views." },
	],
	anatomy: [
		{ part: "Container", description: "A square of the size's height; no text padding." },
		{
			part: "Icon",
			description: "`icon`, sized by the button; replaced by the spinner while loading.",
		},
		{
			part: "Focus ring",
			description:
				"A 2px `primary` outline; on `ghost` it sits 2px inside so clipped header strips keep it.",
		},
		{ part: "Tooltip", description: "Always present: `tooltip` if given, otherwise the `label`." },
	],
	props: {
		icon: {
			type: "ButtonIcon",
			description:
				"The icon component (pass `RiCloseLine`, not `<RiCloseLine />`). Line by default, Fill for an active state.",
		},
		label: {
			type: "string",
			description:
				"Required. The accessible name (`aria-label`) and the default tooltip text. Use a locale key.",
		},
		...sharedPropDocs,
		variant: { ...sharedPropDocs.variant, default: '"ghost"' },
		size: { ...sharedPropDocs.size, default: '"m"' },
		tooltip: {
			type: "ReactNode",
			description:
				"Overrides the tooltip text (for example to add a shortcut) while `label` stays the accessible name.",
		},
	} satisfies Record<OwnProps<IconButtonProps>, PropDoc>,
	nativeProps: {
		title: "Native button props",
		props: {
			type: {
				type: '"button" | "submit" | "reset"',
				default: '"button"',
				description: "Native button type.",
			},
			disabled: {
				type: "boolean",
				description:
					"Disabled roles; the tooltip still opens on hover so the reason stays readable.",
			},
			onClick: {
				type: "MouseEventHandler",
				description: "Activation handler (pointer, Enter, Space).",
			},
			className: {
				type: "string",
				description:
					"Placement only, including whole-button hover reveal (`opacity-0 group-hover:opacity-100`).",
			},
		} satisfies Partial<Record<keyof IconButtonProps, PropDoc>>,
	},
	variants: variantDocs,
	sizes: {
		...sizeDocs,
		m: "The default for IconButton — panel headers, tab strips, toolbars and toasts.",
		l: "Standalone icon actions next to L buttons.",
	},
	tones: {
		note: "`tone` applies to `outline` and `ghost`; other variants ignore it.",
		docs: toneDocs,
	},
	sections: [
		{ id: "variants", title: "Variants and sizes" },
		{
			id: "states",
			title: "States",
			description:
				"Every cell is the real component. Hover and press the first column, or click into the page and press Tab to see keyboard focus. Disabled, loading and selected are real props.",
		},
		{ id: "tone", title: "Tone" },
	],
	states: [
		{
			state: "Default",
			how: "Rest.",
			appearance: "The variant's fill; `ghost` shows only the muted icon.",
		},
		{
			state: "Hover",
			how: "Pointer over the button.",
			appearance: "The variant's hover role; the tooltip opens after the shared delay.",
		},
		{ state: "Pressed", how: "Pointer down or Space held.", appearance: "Identical to hover." },
		{
			state: "Keyboard focus",
			how: "Tab to the button.",
			appearance: "Focus ring and the tooltip.",
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance: "Disabled roles; tooltip still opens on hover.",
		},
		{
			state: "Loading",
			how: "`loading` (optionally `spinIcon`).",
			appearance: "Spinner or rotating icon, same square, `aria-busy`.",
		},
		{
			state: "Selected",
			how: "`selected` or an open Radix trigger.",
			appearance: "Selected fill on `outline` / `ghost`.",
		},
	],
	accessibility: [
		"`label` is mandatory and becomes `aria-label`; the icon is `aria-hidden`.",
		"The tooltip repeats the label for sighted pointer and keyboard users; `tooltip` may add detail but never replaces the name.",
		"A toggle sets `aria-pressed`; a disclosure sets `aria-expanded`.",
		"Keep icons conventional; when a reader could misread the icon, use a Button with a label instead.",
	],
	keyboard: [
		{ keys: "Tab / Shift+Tab", action: "Moves focus; the focus ring and the tooltip appear." },
		{ keys: "Enter / Space", action: "Activates. Space shows the pressed state while held." },
		{ keys: "Escape", action: "Closes the tooltip (and a dialog or menu beneath it)." },
	],
	rules: [
		{
			id: "ICB-1",
			text: "Every icon-only action is an IconButton with a `label` from a locale key — never a raw `<button>` with an icon.",
		},
		{
			id: "ICB-2",
			text: "Do not add `title` or a hand-rolled tooltip wrapper; use `tooltip` to extend the text.",
		},
		{
			id: "ICB-3",
			text: "Use `ghost` for chrome actions; reserve filled variants for an icon action that is the main action.",
		},
		{
			id: "ICB-4",
			text: "Use `selected` with `aria-pressed` for persistent toggles; never fake an on state with classes.",
		},
	],
	examples: [
		{
			id: "basic",
			title: "Basic",
			description: "The label is the accessible name and the tooltip.",
		},
		{ id: "sizes", title: "Sizes", description: "S, M (default) and L." },
		{ id: "variants", title: "Variants", description: "Every variant as an icon-only button." },
		{
			id: "tooltip",
			title: "Tooltip text",
			description: "`tooltip` adds detail while `label` stays the name.",
		},
		{
			id: "toggle",
			title: "Toggle",
			description: "A header toggle with `selected` and `aria-pressed`.",
		},
		{
			id: "menu-trigger",
			title: "Menu trigger",
			description: "Inside `DropdownMenuTrigger asChild`; selected while open.",
		},
		{
			id: "disabled-reason",
			title: "Disabled with a reason",
			description: "The tooltip explains the disabled state.",
		},
		{
			id: "loading",
			title: "Loading and refresh",
			description: "Spinner, and `spinIcon` rotating the icon in place.",
		},
		{ id: "tone", title: "Tone", description: "Danger and warning icon actions." },
	],
	usages: [
		{ file: "packages/ui/dialog.tsx", note: "Every dialog's Close button (ghost, m)." },
		{ file: "packages/ui/toast.tsx", note: "`ToastClose`." },
		{
			file: "apps/web/src/panels/HeaderIconButton.tsx",
			note: "Panel header toggles with `selected` and `aria-pressed`.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchTabs.tsx",
			note: "Tab close and the open-tabs search trigger.",
		},
		{
			file: "apps/web/src/chat/CopyButton.tsx",
			note: "Message copy action at size S, revealed on hover.",
		},
	],
	contract: "components/button-system.md",
} satisfies ComponentDoc;
