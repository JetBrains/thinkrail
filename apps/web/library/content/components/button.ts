import type { ButtonProps, ButtonSize, ButtonTone, ButtonVariant } from "@thinkrail/ui/button";
import type { ButtonHTMLAttributes } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type OwnProps<P> = Exclude<keyof P, keyof ButtonHTMLAttributes<HTMLButtonElement>>;

export const variantDocs = {
	primary:
		"The main action of a surface — Save, Create, Send. Accent fill. Use at most one per decision.",
	"soft-primary":
		"An accent action that should not compete with the main one — Sign in, Show in panel, an update affordance. Accent tint and accent label.",
	outline:
		"A neutral, clearly bounded action — Cancel beside a primary, API key, Not now. The default secondary action.",
	ghost:
		"A quiet action with no surface of its own — toolbar, header and row actions, Dismiss. Muted label with a neutral hover fill.",
	destructive:
		"Confirms an irreversible action — Delete, Discard. Danger fill. Ask first; use it on the confirming step.",
} as const satisfies Record<ButtonVariant, string>;

export const sizeDocs = {
	s: "Dense rows, inline chips and comment cards, where the button sits inside a line of content.",
	m: "Panel headers, toolbars, popovers and secondary actions in settings rows.",
	l: "The default for Button — dialog footers, empty states and standalone actions.",
} as const satisfies Record<ButtonSize, string>;

export const toneDocs = {
	warning:
		"A ghost or outline action whose label must read as a warning in every state (a pending MCP approval).",
	danger:
		"A ghost or outline action whose label must read as dangerous in every state without a danger fill (Stop all).",
} as const satisfies Record<ButtonTone, string>;

export const sharedPropDocs = {
	variant: {
		type: '"primary" | "soft-primary" | "outline" | "ghost" | "destructive"',
		default: '"primary"',
		description: "The action's role. Pick it by meaning, not by the colour you want.",
	},
	size: {
		type: '"s" | "m" | "l"',
		default: '"l"',
		description:
			"Height, padding, gap and icon size together. Values live in the Button system contract (*Sizes*).",
	},
	tone: {
		type: '"warning" | "danger"',
		description:
			"Keeps the feedback colour on the label in every state. Applies to `ghost` and `outline`; other variants ignore it.",
	},
	selected: {
		type: "boolean",
		default: "false",
		description:
			'Persistent toggle or open state. Styled on `outline`, `ghost` and `soft-primary`. An open Radix trigger (`data-state="open"`) shows it automatically. Pair a toggle with `aria-pressed`.',
	},
	loading: {
		type: "boolean",
		default: "false",
		description:
			"Shows an icon-sized spinner without changing geometry, sets `aria-busy` and natively disables the button so the action cannot run twice.",
	},
	spinIcon: {
		type: "boolean",
		default: "false",
		description:
			"With `loading`, rotates the button's own icon in place instead of swapping in the spinner — for a refresh whose content stays valid.",
	},
	tooltip: {
		type: "ReactNode",
		description:
			"An explanation shown through the shared tooltip, also while disabled. Replaces the native `title`, which the button does not accept.",
	},
	tooltipSide: {
		type: '"top" | "right" | "bottom" | "left"',
		description: "Preferred tooltip side.",
	},
	tooltipAlign: {
		type: '"start" | "center" | "end"',
		description: "Tooltip alignment along that side.",
	},
	wrapTrigger: {
		type: "boolean",
		description:
			"Wraps the tooltip trigger in a span. Automatic while `disabled`; set `true` to keep the span permanently or to isolate a second Radix trigger, `false` to opt out.",
	},
	ref: {
		type: "Ref<HTMLButtonElement>",
		description: "Forwarded to the `<button>` element (React 19 ref prop).",
	},
} as const satisfies Record<string, PropDoc>;

export const button = {
	slug: "button",
	name: "Button",
	group: "General",
	source: "packages/ui/button.tsx",
	preview: "variants",
	tag: "<Button",
	importLine: 'import { Button } from "@thinkrail/ui/button";',
	summary:
		"The one action button for text actions, with optional leading and trailing icons. It owns its geometry, colour, typography and every interaction state; call sites choose a variant and size and add only placement.",
	whenToUse: [
		"Any ordinary action with a visible label: submit, confirm, cancel, open, retry.",
		"A text toggle that stays on, with `selected` and `aria-pressed`.",
		"A link that must look like a button: put `buttonVariants(...)` on the `<a>`, do not nest a button in a link.",
	],
	alternatives: [
		{
			name: "IconButton",
			when: "The action is fully clear from a familiar icon and space is tight. It needs a `label`.",
		},
		{ name: "Switch", when: 'An on/off setting that applies immediately (`role="switch"`).' },
		{ name: "ToggleSegment", when: "Choosing one view among a small set in a header strip." },
		{
			name: "Menu item",
			when: "An action inside a dropdown or context menu (`menuItemClass` rows).",
		},
		{ name: "Text link", when: "Navigation inside prose or metadata." },
	],
	anatomy: [
		{
			part: "Container",
			description:
				"The `<button>` with the variant's fill, a 1px border slot and the size's height and padding.",
		},
		{
			part: "Leading icon",
			description: "`iconLeft`, sized by the button; replaced by the spinner while loading.",
		},
		{ part: "Label", description: "The children; one line, never wraps." },
		{ part: "Trailing icon", description: "`iconRight`, sized by the button." },
		{
			part: "Focus ring",
			description: "A 2px `primary` outline offset by 2px, shown for keyboard focus only.",
		},
		{ part: "Tooltip", description: "Optional `tooltip`, rendered by the shared IconTooltip." },
	],
	props: {
		...sharedPropDocs,
		iconLeft: {
			type: "ButtonIcon",
			description:
				"Leading icon component (pass `RiAddLine`, not `<RiAddLine />`). The button sizes it.",
		},
		iconRight: {
			type: "ButtonIcon",
			description: "Trailing icon component, usually a chevron.",
		},
	} satisfies Record<OwnProps<ButtonProps>, PropDoc>,
	nativeProps: {
		title: "Native button props",
		props: {
			children: { type: "ReactNode", description: 'The label. Use a locale key: `{t("…")}`.' },
			type: {
				type: '"button" | "submit" | "reset"',
				default: '"button"',
				description: "Native button type.",
			},
			disabled: {
				type: "boolean",
				description:
					"Keeps the button in place on the disabled roles (never hidden, never opacity) and blocks pointer and keyboard activation.",
			},
			onClick: {
				type: "MouseEventHandler",
				description: "Activation handler (pointer, Enter, Space).",
			},
			className: {
				type: "string",
				description:
					"Placement only: margins, flex/grid placement, `w-full`, positioning, responsive visibility.",
			},
		} satisfies Partial<Record<keyof ButtonProps, PropDoc>>,
	},
	variants: variantDocs,
	sizes: sizeDocs,
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
		{
			id: "tone",
			title: "Tone",
			description: "`tone` applies to `outline` and `ghost`; other variants ignore it.",
		},
	],
	states: [
		{ state: "Default", how: "Rest.", appearance: "The variant's fill, border and label colour." },
		{
			state: "Hover",
			how: "Pointer over the button.",
			appearance: "The variant's hover role; geometry never moves.",
		},
		{ state: "Pressed", how: "Pointer down or Space held.", appearance: "Identical to hover." },
		{
			state: "Keyboard focus",
			how: "Tab to the button.",
			appearance: "2px `primary` outline with a 2px offset; `ghost` also takes its hover fill.",
		},
		{
			state: "Disabled",
			how: "`disabled`.",
			appearance: "Disabled roles, cursor and activation blocked, tooltip still shown.",
		},
		{
			state: "Loading",
			how: "`loading` (optionally `spinIcon`).",
			appearance: "Spinner at icon size, same width, `aria-busy`, not activatable.",
		},
		{
			state: "Selected",
			how: "`selected` or an open Radix trigger.",
			appearance:
				"Selected fill on `outline` / `ghost`; hover look on `soft-primary`; none on `primary` / `destructive`.",
		},
	],
	accessibility: [
		'Renders a native `<button type="button">`, so role, focus and activation come from the platform.',
		"The label is the accessible name; keep it short and specific. Icons are `aria-hidden`.",
		"Never use `title`; explain with `tooltip`, which also reaches keyboard users and disabled buttons.",
		"A toggle sets `aria-pressed`; a disclosure sets `aria-expanded`; a menu trigger gets its ARIA from Radix.",
		"Loading sets `aria-busy` and disables the button; keep the label so the name does not change.",
		"The tooltip opens on hover and keyboard focus, not on programmatic focus, and one Escape closes it together with the layer beneath.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action: "Moves focus to and from the button; the focus ring appears.",
		},
		{ keys: "Enter / Space", action: "Activates. Space shows the pressed state while held." },
		{ keys: "Escape", action: "Closes an open tooltip (and a dialog or menu beneath it)." },
	],
	rules: [
		{
			id: "BTN-1",
			text: "Choose the variant by the action's role. One `primary` per decision; `destructive` only on the confirming step.",
		},
		{
			id: "BTN-2",
			text: "Pass props, never classes, for appearance. No height, padding, colour, border, radius or typography at the call site.",
		},
		{
			id: "BTN-3",
			text: "Warning or danger emphasis on a quiet action is `tone`, never a colour class.",
		},
		{
			id: "BTN-4",
			text: "Use `loading` for in-flight actions instead of a hand-made spinner; `spinIcon` for a refresh whose content stays valid.",
		},
		{
			id: "BTN-5",
			text: "Explain a disabled or unclear action with `tooltip`; never with `title`.",
		},
		{
			id: "BTN-6",
			text: "Labels come from locale keys and stay on one line; give the button room or `w-full` instead of wrapping.",
		},
	],
	examples: [
		{
			id: "dialog-actions",
			title: "Dialog actions",
			description: "A neutral dismiss beside the main action.",
		},
		{
			id: "icons",
			title: "Icons",
			description: "Leading, trailing and both icons. The button sizes them.",
		},
		{ id: "variants", title: "Variants", description: "Every variant at the default size." },
		{ id: "sizes", title: "Sizes", description: "S, M and L in one variant." },
		{
			id: "loading",
			title: "Loading",
			description: "A real async action: the spinner keeps the width and blocks a second click.",
		},
		{
			id: "refresh",
			title: "Refresh in place",
			description: "`loading` with `spinIcon` rotates the button's own icon.",
		},
		{
			id: "toggle",
			title: "Selected toggle",
			description: "A persistent on/off text toggle with `aria-pressed`.",
		},
		{
			id: "disabled-reason",
			title: "Disabled with a reason",
			description: "The tooltip still explains why while the button is disabled.",
		},
		{ id: "tone", title: "Tone", description: "Warning and danger labels on quiet actions." },
		{
			id: "long-label",
			title: "Long label",
			description:
				"Labels never wrap: the button grows to its label, or fills a column with `w-full`. Keep the column wider than the label; a label that does not fit is shortened, not wrapped.",
		},
		{
			id: "link",
			title: "Link styled as a button",
			description: "`buttonVariants` on an `<a>` for navigation.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/ConfirmDialog.tsx",
			note: "Cancel (outline) and the destructive or primary confirmation.",
		},
		{
			file: "apps/web/src/panels/ProvidersSettings.tsx",
			note: "Sign in / Sign out (soft-primary), API key (outline), refresh with `spinIcon`.",
		},
		{
			file: "apps/web/src/notifications/NotificationPermissionPrompt.tsx",
			note: "Not now (outline) and Enable (primary) in a dialog footer.",
		},
		{
			file: "packages/resource-renderers/src/support/ReviewComposer.tsx",
			note: "Save draft, Send now and Cancel at size S in a comment card.",
		},
		{
			file: "apps/web/src/panels/PlanPane.tsx",
			note: "Open PR with `loading`, plan header actions.",
		},
	],
	contract: "components/button-system.md",
} satisfies ComponentDoc;
