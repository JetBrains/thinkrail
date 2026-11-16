import { isImeComposing } from "@thinkrail/ui/keyboard";
import { keyboardClaimed } from "./extensionCommands";
import { canFocus, REGION_SELECTOR } from "./regions";
import { isInLayer } from "./shortcutLayers";

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
	"text",
	"search",
	"url",
	"email",
	"number",
	"password",
	"tel",
]);
const KEEPS_ESCAPE_SELECTOR = ".monaco-editor, .xterm";
const PARK_SELECTOR = "[data-focus-park]";

export interface FieldTarget {
	readonly tagName: string;
	readonly isContentEditable: boolean;
	readonly type?: string;
	closest(selector: string): unknown;
}

export type EscapePress = Pick<
	KeyboardEvent,
	| "key"
	| "altKey"
	| "ctrlKey"
	| "metaKey"
	| "shiftKey"
	| "isComposing"
	| "keyCode"
	| "defaultPrevented"
>;

function isTextField(target: FieldTarget): boolean {
	if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
	return target.tagName === "INPUT" && TEXT_INPUT_TYPES.has(target.type ?? "");
}

export function leavesField(press: EscapePress, target: FieldTarget, claimed: boolean): boolean {
	return (
		press.key === "Escape" &&
		!press.altKey &&
		!press.ctrlKey &&
		!press.metaKey &&
		!press.shiftKey &&
		!isImeComposing(press) &&
		!press.defaultPrevented &&
		!claimed &&
		isTextField(target) &&
		target.closest(KEEPS_ESCAPE_SELECTOR) === null &&
		!isInLayer(target)
	);
}

export function parkingSpot<T>(
	parks: Iterable<T>,
	root: T,
	focusable: (candidate: T) => boolean,
): T | null {
	for (const park of parks) if (focusable(park)) return park;
	return focusable(root) ? root : null;
}

export function installEscapeLeavesField(): () => void {
	const onKeyDown = (event: KeyboardEvent) => {
		const target = event.composedPath()[0];
		if (!(target instanceof HTMLElement) || !leavesField(event, target, keyboardClaimed())) return;
		const region = target.closest<HTMLElement>(REGION_SELECTOR);
		const spot =
			region && parkingSpot(region.querySelectorAll<HTMLElement>(PARK_SELECTOR), region, canFocus);
		if (!spot) return;
		event.preventDefault();
		spot.focus({ preventScroll: true });
	};
	window.addEventListener("keydown", onKeyDown);
	return () => window.removeEventListener("keydown", onKeyDown);
}
