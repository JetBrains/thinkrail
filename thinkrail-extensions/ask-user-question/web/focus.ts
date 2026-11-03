export type QuestionFocusTarget =
	| "none"
	| "non-editing"
	| "empty-composer"
	| "draft-composer"
	| "editing"
	| "modal";

export function shouldClaimQuestionFocus(
	target: QuestionFocusTarget,
	coarsePointer: boolean,
): boolean {
	if (coarsePointer) return false;
	return target === "none" || target === "non-editing" || target === "empty-composer";
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

const MODAL_SURFACES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

export function focusTargetKind(active: Element | null, card: HTMLElement): QuestionFocusTarget {
	if (!active || active === document.body) return "none";
	if (card.contains(active)) return "non-editing";
	if (!(active instanceof HTMLElement)) return "editing";
	if (active.closest(MODAL_SURFACES)) return "modal";
	if (active.closest(".monaco-editor, .xterm")) return "editing";
	if (active.isContentEditable || active.closest('[contenteditable="true"]')) return "editing";
	const control = active.closest("input, textarea, select, iframe");
	if (!control) return "non-editing";
	if (control instanceof HTMLTextAreaElement && control.dataset.testid === "chat-input") {
		return control.value.length === 0 ? "empty-composer" : "draft-composer";
	}
	return "editing";
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
}

export function currentQuestionPageStart(card: HTMLElement): HTMLElement {
	return (
		activeQuestionPage(card).querySelector<HTMLElement>('[data-ask-page-start="true"]') ?? card
	);
}
