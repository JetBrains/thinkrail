import type { HintAction, HintRect } from "./targets";

const WIDGET_INPUT = "textarea";

export function press(element: HTMLElement, box: HintRect): void {
	const mouse = {
		bubbles: true,
		cancelable: true,
		composed: true,
		view: window,
		button: 0,
		clientX: (box.left + box.right) / 2,
		clientY: (box.top + box.bottom) / 2,
	};
	const pointer = { ...mouse, pointerId: 1, pointerType: "mouse", isPrimary: true };
	if (element.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, buttons: 1 }))) {
		element.focus({ preventScroll: true });
	}
	element.dispatchEvent(new PointerEvent("pointerup", { ...pointer, buttons: 0 }));
	element.dispatchEvent(new MouseEvent("click", { ...mouse, detail: 1 }));
}

export function activate(
	element: HTMLElement,
	action: HintAction,
	focusOnly: boolean,
	box: HintRect,
): void {
	if (action === "widget") {
		(element.querySelector<HTMLElement>(WIDGET_INPUT) ?? element).focus({ preventScroll: true });
	} else if (action === "focus" || focusOnly) {
		element.focus({ preventScroll: true });
	} else {
		press(element, box);
	}
}
