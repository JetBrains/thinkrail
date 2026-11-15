import { isImeComposing } from "@thinkrail/ui/keyboard";
import type { CursorKeyEvent } from "../support/cursorKeys";

export const SWIPE_STEP = 2;
export const SWIPE_PAGE = 10;

const INCREASE = new Set(["ArrowRight", "ArrowUp", "l", "L"]);
const DECREASE = new Set(["ArrowLeft", "ArrowDown", "h", "H"]);

export function swipeDividerValue(value: number, event: CursorKeyEvent): number | null {
	if (isImeComposing(event) || event.altKey || event.ctrlKey || event.metaKey) return null;
	const step = event.shiftKey ? SWIPE_PAGE : SWIPE_STEP;
	let next: number;
	if (event.key === "Home") next = 0;
	else if (event.key === "End") next = 100;
	else if (event.key === "PageUp") next = value + SWIPE_PAGE;
	else if (event.key === "PageDown") next = value - SWIPE_PAGE;
	else if (INCREASE.has(event.key)) next = value + step;
	else if (DECREASE.has(event.key)) next = value - step;
	else return null;
	return Math.min(100, Math.max(0, next));
}
