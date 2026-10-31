import { isTitleBarDoubleClick } from "./titleBarDoubleClick";

export function installLinuxTitleBarDoubleClick(
	target: Pick<EventTarget, "addEventListener">,
	send: () => void,
	readComputedStyle?: Parameters<typeof isTitleBarDoubleClick>[1],
): void {
	target.addEventListener(
		"mousedown",
		(event) => {
			const mouse = event as MouseEvent;
			if (mouse.detail !== 2 || !isTitleBarDoubleClick(mouse, readComputedStyle)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			send();
		},
		{ capture: true },
	);
}
