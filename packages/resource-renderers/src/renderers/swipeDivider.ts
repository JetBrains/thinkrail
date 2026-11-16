import { isImeComposing } from "@thinkrail/ui/keyboard";
import { type CursorKeyEvent, type CursorKeys, cursorTwin } from "../support/cursorKeys";

export const SWIPE_STEP = 2;
export const SWIPE_PAGE = 10;

const INCREASE = new Set(["ArrowRight", "ArrowUp"]);
const DECREASE = new Set(["ArrowLeft", "ArrowDown"]);

export function swipeDividerValue(
	value: number,
	event: CursorKeyEvent,
	keys: CursorKeys,
): number | null {
	if (isImeComposing(event)) return null;
	const twin = cursorTwin(event, keys);
	const horizontal = twin === "ArrowLeft" || twin === "ArrowRight" ? twin : undefined;
	if (horizontal === undefined && (event.altKey || event.ctrlKey || event.metaKey)) return null;
	const key = horizontal ?? event.key;
	const step = event.shiftKey ? SWIPE_PAGE : SWIPE_STEP;
	let next: number;
	if (key === "Home") next = 0;
	else if (key === "End") next = 100;
	else if (key === "PageUp") next = value + SWIPE_PAGE;
	else if (key === "PageDown") next = value - SWIPE_PAGE;
	else if (INCREASE.has(key)) next = value + step;
	else if (DECREASE.has(key)) next = value - step;
	else return null;
	return Math.min(100, Math.max(0, next));
}
