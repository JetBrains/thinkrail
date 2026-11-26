import { revealHorizontally } from "@thinkrail/ui/focus";

export type QuestionFocusTarget =
	| "none"
	| "inside"
	| "empty-composer"
	| "element"
	| "editing"
	| "modal";

const CLAIMABLE: ReadonlySet<QuestionFocusTarget> = new Set(["none", "empty-composer", "element"]);

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

export function focusTargetKind(active: FocusedNode | null, inside: boolean): QuestionFocusTarget {
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
	return "element";
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

type Focuser = (element: HTMLElement) => void;

const focusInPlace: Focuser = (element) => element.focus({ preventScroll: true });

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

export function revealActiveTab(root: ParentNode | null): void {
	const chip = root?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
	if (chip) revealHorizontally(chip);
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
