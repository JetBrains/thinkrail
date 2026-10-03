export const MODAL_LAYER_SELECTOR = [
	'[aria-modal="true"]',
	'[role="dialog"][data-state="open"]',
	'[role="alertdialog"][data-state="open"]',
].join(", ");

const DISMISSIBLE_LAYER_SELECTOR = [MODAL_LAYER_SELECTOR, '[role="menu"][data-state="open"]'].join(
	", ",
);

const GROUP_LAYER_SELECTOR = '[data-testid="history-overlay"]';

export function hasLayer(root: Pick<Document, "querySelector">, selector: string) {
	return root.querySelector(selector) !== null;
}

export function hasDismissibleLayer(doc: Pick<Document, "querySelector" | "activeElement">) {
	return (
		hasLayer(doc, DISMISSIBLE_LAYER_SELECTOR) ||
		hasLayer(doc.activeElement?.closest("[data-group-id]") ?? doc, GROUP_LAYER_SELECTOR)
	);
}

const TERMINAL_ROOT_SELECTOR = ".xterm";

export function isInTerminal(target: EventTarget | null) {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}
