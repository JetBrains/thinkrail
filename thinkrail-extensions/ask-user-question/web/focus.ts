export type QuestionFocusTarget =
	| "none"
	| "inside"
	| "empty-composer"
	| "pointer"
	| "keyboard"
	| "editing"
	| "modal";

const CLAIMABLE: ReadonlySet<QuestionFocusTarget> = new Set(["none", "empty-composer", "pointer"]);

export function shouldClaimQuestionFocus(
	target: QuestionFocusTarget,
	coarsePointer: boolean,
	mayClaim: boolean,
): boolean {
	return mayClaim && !coarsePointer && CLAIMABLE.has(target);
}

export function shouldFocusPageTarget(textEntryTarget: boolean, coarsePointer: boolean): boolean {
	return !(textEntryTarget && coarsePointer);
}

export function createQuestionAttentionClaim(): (scope: object, toolCallId: string) => boolean {
	const claims = new WeakMap<object, Set<string>>();
	return (scope, toolCallId) => {
		let ids = claims.get(scope);
		if (!ids) {
			ids = new Set<string>();
			claims.set(scope, ids);
		}
		if (ids.has(toolCallId)) return false;
		ids.add(toolCallId);
		return true;
	};
}

export interface FocusedNode {
	readonly ownerDocument: { readonly body: unknown; readonly documentElement: unknown } | null;
	readonly tagName: string;
	readonly value?: unknown;
	readonly isContentEditable?: boolean;
	getAttribute(name: string): string | null;
	closest(selectors: string): unknown;
}

const MODAL_SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';
const EDITING_SURFACES = '.monaco-editor, .xterm, [contenteditable="true"]';
const TEXT_CONTROLS = "input, textarea, select, iframe";

export function focusTargetKind(
	active: FocusedNode | null,
	inside: boolean,
	keyboardFocused: boolean,
): QuestionFocusTarget {
	const page = active?.ownerDocument;
	if (!active || !page || active === page.body || active === page.documentElement) return "none";
	if (inside) return "inside";
	if (active.closest(MODAL_SURFACES)) return "modal";
	if (active.isContentEditable || active.closest(EDITING_SURFACES)) return "editing";
	if (active.closest(TEXT_CONTROLS)) {
		const emptyComposer =
			active.tagName === "TEXTAREA" &&
			active.getAttribute("data-testid") === "chat-input" &&
			active.value === "";
		return emptyComposer ? "empty-composer" : "editing";
	}
	return keyboardFocused ? "keyboard" : "pointer";
}

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
	"Shift",
	"Control",
	"Alt",
	"Meta",
	"CapsLock",
	"AltGraph",
]);

let keyboardLast = false;
let keyboardFocus: EventTarget | null = null;

export function watchInputModality(target: Pick<Document, "addEventListener">): void {
	target.addEventListener(
		"keydown",
		(event) => {
			if (!MODIFIER_KEYS.has(event.key)) keyboardLast = true;
		},
		true,
	);
	target.addEventListener(
		"pointerdown",
		() => {
			keyboardLast = false;
			keyboardFocus = null;
		},
		true,
	);
	target.addEventListener(
		"focusin",
		(event) => {
			keyboardFocus = keyboardLast ? event.target : null;
		},
		true,
	);
}

if (typeof document !== "undefined") watchInputModality(document);

export function isKeyboardFocused(active: object | null): boolean {
	return active !== null && active === keyboardFocus;
}

export function hasCoarsePointer(): boolean {
	return window.matchMedia("(pointer: coarse)").matches;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		(!!target.closest("input, textarea, select") ||
			target.isContentEditable ||
			!!target.closest('[contenteditable="true"]'))
	);
}

const FOCUSABLE = "a[href], button, input, label, select, textarea, [tabindex]";

export function isCardBackground(target: EventTarget | null, card: HTMLElement): boolean {
	return target instanceof Element && target.closest(FOCUSABLE) === card;
}

export function isInsidePreview(target: EventTarget | null): boolean {
	return target instanceof Element && !!target.closest("[data-ask-preview]");
}

interface Span {
	readonly top: number;
	readonly bottom: number;
}

export function revealDelta(view: Span, target: Span): number {
	if (target.top < view.top) return target.top - view.top;
	if (target.bottom > view.bottom) {
		return Math.min(target.bottom - view.bottom, target.top - view.top);
	}
	return 0;
}

export function scrollsVertically(element: Element): boolean {
	const { overflowY } = getComputedStyle(element);
	return (
		(overflowY === "auto" || overflowY === "scroll") &&
		element.scrollHeight > element.clientHeight + 1
	);
}

function outlineExtent(element: Element): number {
	const { outlineStyle, outlineWidth, outlineOffset } = getComputedStyle(element);
	if (outlineStyle === "none") return 0;
	return Math.max(
		0,
		(Number.parseFloat(outlineWidth) || 0) + (Number.parseFloat(outlineOffset) || 0),
	);
}

type Focuser = (element: HTMLElement) => void;

const focusInPlace: Focuser = (element) => element.focus({ preventScroll: true });

export const focusAndReveal: Focuser = (element) => {
	element.focus({ preventScroll: true });
	let scroller = element.parentElement;
	while (scroller && !scrollsVertically(scroller)) scroller = scroller.parentElement;
	if (!scroller) return;
	const top = scroller.getBoundingClientRect().top + scroller.clientTop;
	const box = element.getBoundingClientRect();
	const ring = outlineExtent(element);
	scroller.scrollTop += revealDelta(
		{ top, bottom: top + scroller.clientHeight },
		{ top: box.top - ring, bottom: box.bottom + ring },
	);
};

export function activeQuestionPage(card: HTMLElement): HTMLElement {
	return card.querySelector<HTMLElement>('[data-ask-active="true"]') ?? card;
}

export function focusCurrentQuestionPage(card: HTMLElement, focus: Focuser = focusInPlace): void {
	const target = activeQuestionPage(card).querySelector<HTMLElement>(
		'[data-ask-page-focus="true"]:not([disabled])',
	);
	if (!target) return;
	if (!shouldFocusPageTarget(isTextEntryTarget(target), hasCoarsePointer())) return;
	focus(target);
}

export function focusQuestionAttention(card: HTMLElement, focus: Focuser = focusInPlace): void {
	const selected = activeQuestionPage(card).querySelector<HTMLElement>(
		'[data-ask-discuss-text], [data-ask-option][data-selected="true"], [data-ask-custom-row][data-selected="true"] textarea',
	);
	if (selected) focus(selected);
	else focusCurrentQuestionPage(card, focus);
	if (card.contains(document.activeElement)) return;
	const claim = card.querySelector<HTMLElement>("[data-focus-claim]");
	if (claim) focus(claim);
}
