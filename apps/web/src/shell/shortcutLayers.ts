import { hasLayer, MODAL_LAYER_SELECTOR } from "../lib";

export { hasLayer, MODAL_LAYER_SELECTOR };

const DISMISSIBLE_LAYER_SELECTOR = [MODAL_LAYER_SELECTOR, '[role="menu"][data-state="open"]'].join(
	", ",
);

const GROUP_LAYER_SELECTOR = '[data-testid="history-overlay"]';

const GROUP_ID_SELECTOR = "[data-group-id]";

export interface LayerDocument
	extends Pick<Document, "querySelector" | "querySelectorAll" | "activeElement"> {}

function hasGroupLayer(doc: LayerDocument) {
	const groupId = doc.activeElement?.closest(GROUP_ID_SELECTOR)?.getAttribute("data-group-id");
	if (groupId == null) return hasLayer(doc, GROUP_LAYER_SELECTOR);
	return Array.from(doc.querySelectorAll(GROUP_ID_SELECTOR)).some(
		(el) => el.getAttribute("data-group-id") === groupId && hasLayer(el, GROUP_LAYER_SELECTOR),
	);
}

export function hasDismissibleLayer(doc: LayerDocument) {
	return hasLayer(doc, DISMISSIBLE_LAYER_SELECTOR) || hasGroupLayer(doc);
}

const TERMINAL_ROOT_SELECTOR = ".xterm";

export function isInTerminal(target: EventTarget | null) {
	return target instanceof Element && target.closest(TERMINAL_ROOT_SELECTOR) !== null;
}
