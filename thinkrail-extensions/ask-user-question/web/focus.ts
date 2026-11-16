export type QuestionFocusTarget = "none" | "inside" | "empty-composer" | "occupied";

export function shouldClaimQuestionFocus(
	target: QuestionFocusTarget,
	coarsePointer: boolean,
	mayClaim: boolean,
): boolean {
	return mayClaim && !coarsePointer && (target === "none" || target === "empty-composer");
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
	getAttribute(name: string): string | null;
}

export function focusTargetKind(active: FocusedNode | null, inside: boolean): QuestionFocusTarget {
	const page = active?.ownerDocument;
	if (!active || !page || active === page.body || active === page.documentElement) return "none";
	if (inside) return "inside";
	const emptyComposer =
		active.tagName === "TEXTAREA" &&
		active.getAttribute("data-testid") === "chat-input" &&
		active.value === "";
	return emptyComposer ? "empty-composer" : "occupied";
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

export function activeQuestionPage(card: HTMLElement): HTMLElement {
	return card.querySelector<HTMLElement>('[data-ask-active="true"]') ?? card;
}

export function focusCurrentQuestionPage(card: HTMLElement): void {
	const target = activeQuestionPage(card).querySelector<HTMLElement>(
		'[data-ask-page-focus="true"]:not([disabled])',
	);
	if (!target) return;
	if (!shouldFocusPageTarget(isTextEntryTarget(target), hasCoarsePointer())) return;
	target.focus({ preventScroll: true });
}

export function focusQuestionAttention(card: HTMLElement): void {
	const selected = activeQuestionPage(card).querySelector<HTMLElement>(
		'[data-ask-discuss-text], [data-ask-option][data-selected="true"], [data-ask-custom-row][data-selected="true"] textarea',
	);
	if (selected) selected.focus({ preventScroll: true });
	else focusCurrentQuestionPage(card);
	if (card.contains(document.activeElement)) return;
	card.querySelector<HTMLElement>("[data-focus-claim]")?.focus({ preventScroll: true });
}
