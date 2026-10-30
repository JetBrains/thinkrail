import type {
	Toast,
	ToastAction,
	ToastProvider,
	ToastViewport,
	toastVariants,
} from "@thinkrail/ui/toast";
import type { ComponentProps } from "react";
import type { ComponentDoc, PropDoc } from "../types";

type ToastProps = ComponentProps<typeof Toast>;
type ViewportProps = ComponentProps<typeof ToastViewport>;
type ProviderProps = ComponentProps<typeof ToastProvider>;
type ActionProps = ComponentProps<typeof ToastAction>;
/** The keys `toastVariants` adds on top of Radix `Toast.Root` — everything else passes through. */
type ToastOwnProps = Exclude<
	keyof NonNullable<Parameters<typeof toastVariants>[0]>,
	"class" | "className"
>;
export type ToastVariant = NonNullable<ToastProps["variant"]>;

export const toastVariantDocs = {
	info: "Neutral news and no-ops: Check All is already running, nothing to review, a project was closed, workspaces moved to Settled. The default.",
	success: "A finished action the user started: plan copied, review started, a revert with Undo.",
	warning:
		"Something worked only partly or needs attention soon, but nothing failed. Raised through `toast.warning`.",
	error:
		"A failed action with no better place to land — no form or chat turn to show it inline. Persists until dismissed.",
} as const satisfies Record<ToastVariant, string>;

export const toastIcons = {
	info: "RiInformationLine",
	success: "RiCheckboxCircleLine",
	warning: "RiAlertLine",
	error: "RiErrorWarningLine",
} as const satisfies Record<ToastVariant, string>;

export const toast = {
	slug: "toast",
	name: "Toast",
	group: "Feedback",
	source: "packages/ui/toast.tsx",
	preview: "preview",
	tag: "<Toast",
	importLine:
		'import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@thinkrail/ui/toast";',
	summary:
		"A transient message in the corner of the window: Radix Toast with ThinkRail's viewport, a neutral elevated card whose border carries the severity, title and description type, and a Dismiss icon button. The primitives own the live-region announcement, the timers (paused on hover and focus), swipe and Escape dismissal, and the F8 landmark. The app composes them once in `panels/Toaster` — which adds the severity icon, the layout, the action footer and each toast's lifetime — and features raise toasts through the store's `toast.*` / `pushToast`. The shared look of toasts and inline notices is the [Notices](#/notices) pattern.",
	whenToUse: [
		"Reporting the result of something the user just did when the result is not otherwise visible: Plan copied, Review started, Check All started.",
		"A failed background or fire-and-forget call with no better place to land — no open dialog, form or chat turn to show it inline.",
		"A receipt with one short follow-up: Undo after a revert, Show after workspaces moved to Settled.",
		"From a feature: call `toast.success|info|warning|error(message, title?)` or `pushToast({ …, action, durationMs })` from `@/store`. Compose the parts yourself only inside `panels/Toaster`.",
	],
	alternatives: [
		{
			name: "SettingsNotice",
			when: "A lasting condition on a Settings page — a missing permission, a disconnected CLI, a theme file that failed to load.",
		},
		{
			name: "StaleComposerNotice",
			when: "A condition that belongs to the chat composer and stays until the user acts on it.",
		},
		{
			name: "ConfirmDialog",
			when: "The user must decide before anything happens. A toast never asks a question.",
		},
		{
			name: "Inline error",
			when: "The error can be fixed in place in a form or dialog that stays open — show it there (the template editor's `template-error`). A rejection with nowhere to land, such as a failed workspace create, still toasts.",
		},
	],
	anatomy: [
		{
			part: "ToastProvider",
			description:
				'Radix `Provider`, unchanged. Holds the one viewport, the default `duration`, `swipeDirection` and the announcement `label`. Toaster sets `swipeDirection="right"`.',
		},
		{
			part: "ToastViewport",
			description:
				'Radix `Viewport`: an `ol` inside a `role="region"` landmark labelled `common.notificationsRegion` ("Notifications (F8)"). Fixed at `z-[100]`: a full-width column at the bottom of the window, from `sm` a fixed-width column (`sm:w-[380px]`) in the bottom-right corner, toasts stacked with `gap-8` inside `p-12`. It takes no pointer events while empty.',
		},
		{
			part: "Toast",
			description:
				"Radix `Root`, an `li` portalled into the viewport: a `rounded-sm` card on `container-elevated-bg` with a border in `feedback-*-muted`, the medium shadow, `p-12`, `text-default`, children stacked in a column. Slides in on open, out on close and follows a horizontal swipe through `data-state` and `data-swipe`.",
		},
		{
			part: "Content row",
			description:
				"Call-site markup (Toaster): `flex items-start gap-8` holding the severity icon, the text column (`flex min-w-0 flex-1 flex-col gap-4`) and ToastClose.",
		},
		{
			part: "Severity icon",
			description:
				"Call-site markup: one Line glyph per variant, `mt-2 size-14 shrink-0`, `text-feedback-*`, `aria-hidden`. The primitive renders no icon.",
		},
		{
			part: "ToastTitle",
			description: "Radix `Title`, a `div` in `tr-title-compact`. Optional.",
		},
		{
			part: "ToastDescription",
			description:
				"Radix `Description`, a `div` in `tr-text-ui` and `text-muted` that breaks long tokens (`[overflow-wrap:anywhere]`). Without a title Toaster sets `text-text-default` so the message reads as the main line.",
		},
		{
			part: "ToastClose",
			description:
				"Radix `Close` with `asChild` around an IconButton (ghost, M, `RiCloseLine`, label `common.dismiss`) pushed right with `ml-auto shrink-0`. `className` reaches the IconButton; children are ignored.",
		},
		{
			part: "ToastAction",
			description:
				"Radix `Action`, unstyled: use `asChild` on a Button (outline, M) in a `mt-12 flex justify-end` footer. Activating it also closes the toast.",
		},
		{
			part: "toastVariants",
			description:
				"The `cva` recipe behind Toast (surface, animation, swipe and the variant border), exported for completeness. Call sites use `<Toast variant>`.",
		},
	],
	props: {
		variant: {
			type: '"info" | "success" | "warning" | "error"',
			default: '"info"',
			description:
				"`Toast`. The severity: sets the border colour only. Pick the matching icon and colour it with the same `feedback-*` role.",
		},
		label: {
			type: "string",
			default: 't("common.notificationsRegion")',
			description:
				"`ToastViewport`. The landmark name; ThinkRail localizes Radix's English default. `{hotkey}` is replaced with the hotkey (F8).",
		},
	} satisfies Record<ToastOwnProps, PropDoc> & Pick<Record<keyof ViewportProps, PropDoc>, "label">,
	nativeProps: {
		title: "Radix props in common use (passed through unchanged)",
		props: {
			duration: {
				type: "number",
				default: "5000",
				description:
					"`ToastProvider` default and per-`Toast` override, in ms. Toaster passes `durationMs ?? (error ? Infinity : 5000)`; `Number.POSITIVE_INFINITY` keeps a toast until it is dismissed.",
			},
			open: {
				type: "boolean",
				description:
					"`Toast`. Controlled open state. Toaster leaves it uncontrolled (open on mount) and removes the item from the queue when it closes.",
			},
			defaultOpen: {
				type: "boolean",
				default: "true",
				description: "`Toast`. An uncontrolled toast opens as soon as it mounts.",
			},
			onOpenChange: {
				type: "(open: boolean) => void",
				description:
					"`Toast`. Called with `false` on timeout, Close, the action, Escape and a completed swipe. Remove the toast from its queue here (`dismissToast(id)`).",
			},
			type: {
				type: '"foreground" | "background"',
				default: '"foreground"',
				description:
					"`Toast`. `foreground` announces assertively, `background` politely. Toaster uses the default.",
			},
			onPause: {
				type: "() => void",
				description:
					"`Toast`. The timer paused: pointer over the viewport, focus inside it, or the window lost focus.",
			},
			onResume: {
				type: "() => void",
				description: "`Toast`. The timer resumed with the remaining time.",
			},
			swipeDirection: {
				type: '"up" | "down" | "left" | "right"',
				default: '"right"',
				description:
					"`ToastProvider`. Keep `right`: the toast's swipe classes translate horizontally only.",
			},
			swipeThreshold: {
				type: "number",
				default: "50",
				description: "`ToastProvider`. Pixels a swipe must travel before it dismisses.",
			},
			hotkey: {
				type: "string[]",
				default: '["F8"]',
				description: "`ToastViewport`. The keys that move focus to the viewport.",
			},
			altText: {
				type: "string",
				description:
					"`ToastAction`. Required and non-empty (Radix renders nothing otherwise). Announced instead of the action's own text; Toaster passes the action label.",
			},
			asChild: {
				type: "boolean",
				description: "`ToastAction`. Merge onto the child Button.",
			},
			className: {
				type: "string",
				description:
					"Placement only. On ToastDescription the one sanctioned override is `text-text-default` when there is no title.",
			},
		} satisfies Partial<
			Record<
				keyof ToastProps | keyof ViewportProps | keyof ProviderProps | keyof ActionProps,
				PropDoc
			>
		>,
	},
	variants: toastVariantDocs,
	states: [
		{
			state: "Entering",
			how: 'A Toast mounts (`data-state="open"`).',
			appearance: "The `toast-in` keyframes: it fades in while rising into place.",
		},
		{
			state: "Closing",
			how: 'Timeout, Close, the action or Escape (`data-state="closed"`).',
			appearance: "The `toast-out` keyframes: it fades out while sinking, then unmounts.",
		},
		{
			state: "Paused",
			how: "Pointer over the viewport, focus inside it, or the window is not focused.",
			appearance: "No distinct treatment; every timer in the viewport stops and resumes on leave.",
		},
		{
			state: "Persistent",
			how: "`duration={Number.POSITIVE_INFINITY}` (every error toast).",
			appearance: "No distinct treatment; it stays until Close, Escape or a swipe.",
		},
		{
			state: "Swiping",
			how: "Drag the toast to the right (`data-swipe`).",
			appearance:
				"`move`: it follows the pointer with transitions off. `cancel` (under the threshold): it snaps back. `end`: it plays `toast-out` and closes.",
		},
		{
			state: "Focused toast",
			how: "Tab into the viewport, or F8 then Tab.",
			appearance: "No ThinkRail focus style on the card; the browser's default focus outline.",
		},
		{
			state: "Close hover / focus",
			how: "Pointer over Dismiss, or Tab to it.",
			appearance:
				"The IconButton's ghost hover and focus ring, and its `common.dismiss` tooltip above the viewport.",
		},
		{
			state: "Empty viewport",
			how: "No open toast.",
			appearance: "Nothing visible; the landmark stays in the page and takes no pointer events.",
		},
	],
	accessibility: [
		'ToastViewport is a `role="region"` landmark named by `common.notificationsRegion` ("Notifications (F8)"), so it can be found in the landmark list and reached with F8.',
		'Each new toast is announced through a visually hidden `role="status"` live region — assertive for `type="foreground"` (the default), polite for `background` — with the title and description text, prefixed by the ToastProvider `label`.',
		"ToastClose and ToastAction are excluded from that announcement; the action is announced as its `altText` instead, so make it say what the action does.",
		"Every toast is focusable (`tabIndex=0`). Closing a toast that holds focus moves focus to the viewport rather than losing it.",
		"Timers pause while the pointer is over the viewport, while focus is inside it and while the window is in the background, so a toast is not removed while someone is reading or reaching for it.",
		"Dismiss is an IconButton labelled `common.dismiss`; its tooltip stacks above the viewport. The severity icon is decorative (`aria-hidden`) — the words must carry the meaning.",
	],
	keyboard: [
		{ keys: "F8", action: "Moves focus to the toast viewport." },
		{
			keys: "Tab / Shift+Tab",
			action:
				"From the viewport: walks the toasts newest first — each card, then its controls in DOM order (Dismiss, then the action); after the last one focus continues into the page.",
		},
		{ keys: "Enter / Space", action: "On the action or Dismiss: runs it and closes the toast." },
		{
			keys: "Escape",
			action:
				"With focus on a toast or inside it: closes that toast and moves focus to the viewport. Escape elsewhere does not close toasts.",
		},
	],
	rules: [
		{
			id: "TST-1",
			text: "Raise toasts with `toast.success|info|warning|error` or `pushToast` from `@/store`. Never mount another ToastProvider or compose Toast parts in a feature: `panels/Toaster`, mounted once by Shell, is the only composer.",
		},
		{
			id: "TST-2",
			text: "Toast an outcome, not a question. A decision is a ConfirmDialog; an error the user can fix in a still-open form stays inline (the template editor's `template-error`); a lasting condition on a page is an inline notice.",
		},
		{
			id: "TST-3",
			text: "Severity is `variant` plus its one Line glyph in the matching `text-feedback-*`. Never tint the fill, add a stripe or colour the text — see [Notices](#/notices).",
		},
		{
			id: "TST-4",
			text: "Errors persist until dismissed; every other toast auto-dismisses. A toast with an action gets a bounded `durationMs` long enough to reach it (Undo 8 s, Settled 15 s).",
		},
		{
			id: "TST-5",
			text: 'At most one action: `ToastAction altText asChild` around `Button variant="outline" size="m"` in a `mt-12 flex justify-end` footer. Never a filled button, never a second button.',
		},
		{
			id: "TST-6",
			text: "Write a short title and one sentence, or the sentence alone. Without a title the description takes `text-text-default`. Both come from locale keys; dynamic detail (an error text, a file name) goes in the message.",
		},
		{
			id: "TST-7",
			text: "Keep ToastClose on every toast, including ones with an action. `className` on the parts is placement only.",
		},
	],
	examples: [
		{
			id: "preview",
			title: "Basic",
			description:
				'A success toast with a title, a message and Dismiss, raised again by Copy. The library places the viewport in the card (`className="static p-0 sm:w-full"`) and keeps the toast open; in the app it sits in the corner and leaves after five seconds.',
		},
		{
			id: "severities",
			title: "Severities",
			description:
				"Each `variant` with its icon. Only the border and the icon change colour; the card and the text stay neutral.",
		},
		{
			id: "message-only",
			title: "Message only",
			description:
				"No title: the description takes `text-text-default` and carries the toast alone, as `toast.info(message)` renders.",
		},
		{
			id: "undo",
			title: "Undo receipt",
			description:
				"A success receipt with one Undo action in the footer and the 8-second lifetime `pushToast({ action, durationMs: 8000 })` gives it after a revert. Revert file raises it again.",
		},
		{
			id: "long-error",
			title: "Long error",
			description:
				"An error title with a long, unbroken error text: the description wraps anywhere instead of widening the card. Errors never time out.",
		},
		{
			id: "queue",
			title: "Raised from an action",
			description:
				"The real fixed viewport in the bottom-right corner, fed by a local queue like Toaster's: toasts stack newest last, leave after five seconds (the receipt after eight, errors never), pause while hovered or focused, and swipe right to dismiss.",
		},
	],
	usages: [
		{
			file: "apps/web/src/panels/Toaster.tsx",
			note: 'The one composer: severity icon, title and description, Dismiss, the action footer, `swipeDirection="right"` and every lifetime.',
		},
		{
			file: "apps/web/src/shell/Shell.tsx",
			note: "Mounts `<Toaster />` once above both the workbench and Project Home.",
		},
		{
			file: "apps/web/src/store/appStore.ts",
			note: "The toast queue: `pushToast` (coalescing, five-toast cap) and the `toast.*` helpers features call.",
		},
		{
			file: "packages/ui/labels.test.tsx",
			note: "The viewport's landmark label follows the interface language.",
		},
	],
} satisfies ComponentDoc;
