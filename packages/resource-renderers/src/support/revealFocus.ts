import { focusFirstControl, TABBABLE_SELECTOR } from "@thinkrail/ui/focus";

const CARD_FRAMES = 30;
const CARD_SELECTOR = "[data-comment-id]";
const CARD_LANDING = "[data-focus-row-primary]:not(:disabled)";

export function commentCard(root: ParentNode, commentId: string): HTMLElement | undefined {
	return Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR)).find(
		(element) => element.dataset.commentId === commentId,
	);
}

export function focusReviewCard(target: Element): boolean {
	const card = target.matches(CARD_SELECTOR) ? target : target.querySelector(CARD_SELECTOR);
	if (!(card instanceof HTMLElement)) return focusFirstControl(target);
	const landing = card.querySelector<HTMLElement>(CARD_LANDING) ?? card;
	landing.focus({ preventScroll: true });
	if (landing instanceof HTMLTextAreaElement) {
		const end = landing.value.length;
		landing.setSelectionRange(end, end);
	}
	return document.activeElement === landing;
}

export function revealReviewCard(
	scrollTarget: Element,
	moveFocus: boolean,
	focusTarget: Element = scrollTarget,
): void {
	scrollTarget.scrollIntoView({ block: "center" });
	if (moveFocus) focusReviewCard(focusTarget);
}

export function focusCommentCardWhenRendered(
	root: () => ParentNode | null,
	commentId: string,
): void {
	let frames = CARD_FRAMES;
	const attempt = () => {
		const scope = root();
		const card = scope ? commentCard(scope, commentId) : undefined;
		if (card && focusReviewCard(card)) return;
		if (frames-- > 0) requestAnimationFrame(attempt);
	};
	attempt();
}

export function focusLeftIn(root: Element | null): boolean {
	const active = document.activeElement;
	return (
		!active ||
		active === document.body ||
		active === document.documentElement ||
		(root?.contains(active) ?? false)
	);
}

export function focusBefore(element: Element): boolean {
	let previous: HTMLElement | null = null;
	for (const control of document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)) {
		if (!(control.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) break;
		if (control.closest(CARD_SELECTOR) || control.getClientRects().length === 0) continue;
		previous = control;
	}
	previous?.focus({ preventScroll: true });
	return previous !== null;
}
