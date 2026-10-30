import type {
	IconTooltip,
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@thinkrail/ui/tooltip";
import type { ComponentProps } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type IconTooltipProps = ComponentProps<typeof IconTooltip>;
type PartDocs<P> = Partial<Record<keyof P, PropDoc>>;

const part = (name: string, docs: Readonly<Record<string, PropDoc>>) =>
	Object.fromEntries(Object.entries(docs).map(([prop, doc]) => [`${name}.${prop}`, doc]));

const providerProps = {
	delayDuration: {
		type: "number",
		default: "700",
		description:
			"Hover delay before a tooltip opens. The app root sets `delayDuration={250}` in `apps/web/src/main.tsx` (the library mirrors it); do not override it per tooltip.",
	},
	skipDelayDuration: {
		type: "number",
		default: "300",
		description:
			"Window after a tooltip closes in which the next one opens without delay. The app root sets `400`.",
	},
	disableHoverableContent: {
		type: "boolean",
		default: "false",
		description:
			"Radix pass-through. Left `false`: the pointer may move from the trigger onto the tooltip without closing it.",
	},
} satisfies PartDocs<ComponentProps<typeof TooltipProvider>>;

const rootProps = {
	open: {
		type: "boolean",
		description:
			"Controlled open state. `IconTooltip` always controls it; set it yourself only when composing the parts.",
	},
	onOpenChange: {
		type: "(open: boolean) => void",
		description: "Called by Radix on hover, focus, blur, pointer down, click and dismissal.",
	},
	defaultOpen: { type: "boolean", description: "Uncontrolled initial state (Radix)." },
	delayDuration: {
		type: "number",
		description: "Per-tooltip delay override (Radix). No call site uses it.",
	},
} satisfies PartDocs<ComponentProps<typeof Tooltip>>;

const triggerProps = {
	asChild: {
		type: "boolean",
		description:
			"Merge the trigger's handlers, `data-state` and `aria-describedby` into the single child instead of rendering a `<button>`. Always `true` in ThinkRail.",
	},
} satisfies PartDocs<ComponentProps<typeof TooltipTrigger>>;

const contentProps = {
	sideOffset: {
		type: "number",
		default: "4",
		description: "Gap between trigger and tooltip. The ThinkRail default (Radix's is `0`).",
	},
	side: {
		type: '"top" | "right" | "bottom" | "left"',
		default: '"top"',
		description: "Preferred side; Radix flips it when there is no room.",
	},
	align: {
		type: '"start" | "center" | "end"',
		default: '"center"',
		description: "Alignment along the side.",
	},
	className: {
		type: "string",
		description:
			"Merged after the tooltip skin. No call site passes one; the surface, type and stacking are fixed.",
	},
	"aria-label": {
		type: "string",
		description:
			'Radix: replaces the children in the visually hidden `role="tooltip"` copy that screen readers announce.',
	},
} satisfies PartDocs<ComponentProps<typeof TooltipContent>>;

export const tooltip = {
	slug: "tooltip",
	name: "Tooltip and IconTooltip",
	group: "Overlay",
	source: "packages/ui/tooltip.tsx",
	preview: "preview",
	tag: "<IconTooltip",
	importLine:
		'import { IconTooltip, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@thinkrail/ui/tooltip";',
	summary:
		"A short text hint for a control, shown on hover and keyboard focus. `IconTooltip` is the component call sites use: it wraps one child, opens only on hover or *keyboard-visible* focus, and closes on the same Escape that dismisses the dialog or menu beneath it. The call site provides the trigger, which carries its own accessible name, and the `label`. `Button` and `IconButton` render IconTooltip themselves from `tooltip` and `label`; the Radix parts `Tooltip`, `TooltipTrigger` and `TooltipContent` are what it is built from, and `TooltipProvider` sits once at the app root.",
	whenToUse: [
		"Name an icon-only control for sighted users — automatic on IconButton through `label`.",
		"Explain what a control will do or why it is unavailable: a Switch's on/off hint, a disabled reload while a turn runs.",
		"Add detail to a compact status or chip (quota, transport, checks) whose text is also available to screen readers.",
		"Identify rail entries, with `side` pointing away from the rail edge.",
		"Explain a control that has no `tooltip` prop of its own: a link styled with `buttonVariants`, a Switch, a trigger shared with a popover or menu.",
	],
	alternatives: [
		{
			name: "IconButton",
			when: "The trigger is an icon-only action: its `label` is the name and the tooltip, no wrapper needed.",
		},
		{
			name: "Button",
			when: "The trigger is a text action: pass `tooltip` (and `wrapTrigger` when it is also a Radix trigger).",
		},
		{
			name: "Popover",
			when: "The content is interactive, longer than a line or two, or must open on click and stay open.",
		},
		{
			name: "SettingsNotice",
			when: "The information must be read, not discovered on hover: put it on the surface.",
		},
	],
	anatomy: [
		{
			part: "TooltipProvider",
			description:
				"Radix provider, rendered once at the app root (`apps/web/src/main.tsx`) with the shared delays. Tests that render tooltips wrap in it.",
		},
		{
			part: "Tooltip",
			description: "Radix root: open state. IconTooltip controls it.",
		},
		{
			part: "TooltipTrigger",
			description:
				'Radix trigger, always `asChild`: merges pointer and focus handlers, `data-state` and `aria-describedby` into the child — or into IconTooltip\'s `wrapTrigger` `<span class="flex">`.',
		},
		{
			part: "TooltipContent",
			description:
				"Portalled to `document.body`, offset by `sideOffset`. Elevated container surface with the default border, `rounded-sm`, the small shadow, `tr-text-metadata` in the default text colour, `px-8 py-4`. No arrow and no animation. Stacks at `z-150`, above dialogs and the toast viewport.",
		},
		{
			part: "Screen-reader copy",
			description:
				'Radix renders a visually hidden `role="tooltip"` copy of the content; the trigger points at it with `aria-describedby` while open.',
		},
		{
			part: "IconTooltip",
			description:
				"The composed wrapper: controlled open state, the focus-visible gate, the Escape listener and `side` / `align` forwarding to TooltipContent.",
		},
	],
	props: {
		label: {
			type: "ReactNode",
			description:
				"The tooltip content. Usually a locale string; a node for a structured hint (a name and a second line). Not interactive.",
		},
		children: {
			type: "ReactNode",
			description:
				"The trigger: exactly one element that accepts a ref and event props and carries its own accessible name.",
		},
		side: {
			type: '"top" | "right" | "bottom" | "left"',
			description:
				'Preferred side, forwarded to TooltipContent; omitted means Radix\'s `"top"`. Flips when there is no room.',
		},
		align: {
			type: '"start" | "center" | "end"',
			description: 'Alignment along that side; omitted means `"center"`.',
		},
		wrapTrigger: {
			type: "boolean",
			description:
				'Wraps the child in a `<span class="flex">` that becomes the trigger. Needed when the child is disabled (it ignores the pointer) or is itself a Radix trigger whose `data-state` the tooltip would overwrite.',
		},
	} satisfies Record<keyof IconTooltipProps, PropDoc>,
	nativeProps: {
		title: "Radix parts (props ThinkRail sets or call sites use; other Radix props pass through)",
		props: {
			...part("TooltipProvider", providerProps),
			...part("Tooltip", rootProps),
			...part("TooltipTrigger", triggerProps),
			...part("TooltipContent", contentProps),
		},
	},
	states: [
		{
			state: "Closed",
			how: "Rest.",
			appearance: 'Nothing rendered; the trigger carries `data-state="closed"`.',
		},
		{
			state: "Open on hover",
			how: "Pointer rests on the trigger for the provider delay; within the skip window after another tooltip, it opens at once.",
			appearance:
				'TooltipContent on `side` (top by default); trigger and content carry `data-state="delayed-open"` or `"instant-open"`. The pointer may move onto the tooltip.',
		},
		{
			state: "Open on keyboard focus",
			how: "Tab to the trigger (focus matches `:focus-visible`).",
			appearance: "Opens immediately, no delay, beside the trigger's focus ring.",
		},
		{
			state: "Quiet focus",
			how: "Focus that is not `:focus-visible`: a dialog's or popover's autofocus after a pointer open, focus returning to a clicked trigger, `.focus()` after a click.",
			appearance: "No tooltip (IconTooltip only; the raw parts open on any focus).",
		},
		{
			state: "Pressed",
			how: "Pointer down, click, Enter or Space on the trigger.",
			appearance:
				"Closes, and stays closed until the pointer leaves and re-enters or focus arrives again.",
		},
		{
			state: "Disabled trigger",
			how: "A disabled child with `wrapTrigger` (automatic in Button and IconButton).",
			appearance:
				"Opens on hover over the span. Without `wrapTrigger` it never opens, because the disabled control ignores the pointer. Never on keyboard: a disabled control is not focusable.",
		},
		{
			state: "Dismissed",
			how: "Escape, blur, pointer leaving trigger and tooltip, scrolling a container of the trigger, or another tooltip opening.",
			appearance: "Closes; only one tooltip is open at a time.",
		},
	],
	accessibility: [
		'The tooltip describes; it never names. Radix links the trigger to a visually hidden `role="tooltip"` copy with `aria-describedby` only while open, so the trigger needs its own name (`aria-label` on an icon-only control — IconButton sets it from `label`).',
		"Opens on hover and keyboard-visible focus only. Programmatic focus after a pointer action does not open it, because an open tooltip is the topmost dismissable layer and would swallow the Escape meant for the dialog beneath.",
		"An open IconTooltip closes itself synchronously on Escape in a window capture listener, before Radix's layer handling, so one Escape closes the tooltip and the dialog, popover or menu under it.",
		"A tooltip on a non-focusable element (a status chip, a glyph) is hover-only: repeat its text for screen readers (`sr-only` text or `aria-label`).",
		"A disabled control cannot take focus, so its reason reaches pointer users only; where the reason matters, also set `aria-description` on the control (the Skills switches do).",
		"Radix ignores touch pointers, so tooltips never open on touch. Never put the only copy of essential information, or anything interactive, in a tooltip.",
	],
	keyboard: [
		{
			keys: "Tab / Shift+Tab",
			action: "Focusing the trigger opens the tooltip at once; moving focus away closes it.",
		},
		{ keys: "Enter / Space", action: "Activates the trigger and closes the tooltip." },
		{
			keys: "Escape",
			action:
				"Closes the tooltip; the same keypress also closes the dialog, popover or menu beneath.",
		},
	],
	rules: [
		{
			id: "TIP-1",
			text: "Explain a control with IconTooltip, never with a native `title`. `title` remains only for non-control truncation fallbacks and surfaces outside the provider.",
		},
		{
			id: "TIP-2",
			text: "Button and IconButton already render IconTooltip: pass `tooltip` (and IconButton's `label`). Do not wrap an IconButton in another IconTooltip.",
		},
		{
			id: "TIP-3",
			text: 'Use `wrapTrigger` for a disabled child or a child that is also a Radix trigger (`PopoverTrigger asChild`, `DropdownMenuTrigger asChild`). Never hand-roll the `<span className="flex">` wrapper — `packages/ui/tooltip.test.tsx` rejects it.',
		},
		{
			id: "TIP-4",
			text: "The trigger names itself; the tooltip repeats or extends that name. Labels are short, come from locale keys and contain no links or buttons.",
		},
		{
			id: "TIP-5",
			text: "Call sites use IconTooltip, not the Radix parts: the parts alone open on every focus, and an open one takes the Escape meant for the dialog or menu beneath. Compose the parts only inside `packages/ui`.",
		},
		{
			id: "TIP-6",
			text: "One TooltipProvider at the app root sets the delays. Do not add providers or per-tooltip delays in features; tests that render tooltips wrap in their own provider.",
		},
		{
			id: "TIP-7",
			text: "A tooltip is supplementary: it never opens on touch and is hover-only on non-focusable content. Keep essential information on the surface and repeat a status tooltip's text for screen readers.",
		},
		{
			id: "TIP-8",
			text: "Leave `side` at its default unless the trigger sits against an edge: rail entries point away from their rail (`railTooltipSide`).",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Link with a tooltip",
			description:
				"A link styled with `buttonVariants` has no `tooltip` prop, so it is wrapped; `aria-label` names it.",
		},
		{
			id: "built-in",
			title: "Built into Button and IconButton",
			description:
				"IconButton's `label` is its tooltip, `tooltip` overrides the text, and Button takes `tooltip` — no wrapper.",
		},
		{
			id: "rail",
			title: "Side and structured labels",
			description:
				"Rail entries point their tooltip away from the rail; a node label adds a second line.",
		},
		{
			id: "disabled-control",
			title: "Disabled control",
			description:
				"A Switch keeps its hint; `wrapTrigger` lets the disabled one still show its reason on hover.",
		},
		{
			id: "radix-trigger",
			title: "On a popover trigger",
			description:
				"`wrapTrigger` keeps the popover's open state on the button. Button and IconButton express the same with `tooltip` and `wrapTrigger`.",
		},
		{
			id: "status",
			title: "Non-focusable status",
			description:
				"A transport chip explained on hover; the same text is in `sr-only` for screen readers, since the chip takes no focus.",
		},
		{
			id: "dialog-escape",
			title: "Inside a dialog",
			description:
				"Open it with a click: the autofocused Reload shows no tooltip. Hover Reload and press Escape once — the tooltip and the dialog close together. Open it with Enter and Reload's tooltip shows.",
		},
		{
			id: "parts",
			title: "The Radix parts",
			description:
				"What IconTooltip is built from. No call site composes them: without IconTooltip a tooltip opens on every focus and swallows the first Escape.",
		},
	],
	usages: [
		{
			file: "packages/ui/button.tsx",
			note: "`withTooltip` renders IconTooltip for every Button `tooltip` and IconButton `label`, with `wrapTrigger` while disabled.",
		},
		{
			file: "apps/web/src/chat/SkillsDialog.tsx",
			note: "Skill switches with an on/off hint and `wrapTrigger={disabled}` for the blocked reason.",
		},
		{
			file: "apps/web/src/panels/ReviewPanel.tsx",
			note: "`wrapTrigger` over `PopoverTrigger asChild` for Clear review; plain hints on row actions.",
		},
		{
			file: "apps/web/src/panels/McpSettings.tsx",
			note: "The stdio transport chip, with its text repeated in `sr-only`.",
		},
		{
			file: "apps/web/src/shell/layout/workbenchRails.tsx",
			note: "Rail entries with `side` from `railTooltipSide` and a two-line terminal-group label.",
		},
		{
			file: "apps/web/src/shell/locationBar/BranchSegment.tsx",
			note: "A review link styled with `buttonVariants`, and the checks status on the review chip.",
		},
	],
} satisfies ComponentDoc;
