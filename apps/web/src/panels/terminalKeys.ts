import type { platformFamily } from "@/lib";

const IME_SENTINEL_KEYCODE = 229;

export type TerminalKeyEvent = Pick<
	KeyboardEvent,
	"type" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>;

export type TerminalKeyAction = "copy" | "swallow";

export type TerminalKeyDecision = TerminalKeyAction | { write: string } | null;

export function terminalKeyAction(
	event: TerminalKeyEvent,
	platform: ReturnType<typeof platformFamily>,
	hasSelection: boolean,
): TerminalKeyAction | null {
	if (event.type !== "keydown" || event.altKey || event.metaKey) return null;
	if (platform !== "apple" && event.ctrlKey && event.shiftKey && event.code === "KeyC") {
		return hasSelection ? "copy" : "swallow";
	}
	return null;
}

// xterm #6065: an active IME reports keyCode 229, so xterm's chord table drops Ctrl+<letter>/Escape — see panels/SPEC.md.
function imeControlBytes(event: TerminalKeyEvent): string | null {
	if (event.altKey || event.metaKey) return null;
	if (event.code === "Escape") return "\x1b";
	if (!event.ctrlKey) return null;
	const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
	return letter ? String.fromCharCode(letter.charCodeAt(0) - 64) : null;
}

export function terminalKeyDecision(
	event: TerminalKeyEvent & Pick<KeyboardEvent, "keyCode" | "isComposing">,
	platform: ReturnType<typeof platformFamily>,
	hasSelection: boolean,
): TerminalKeyDecision {
	if (event.isComposing) return null;
	const action = terminalKeyAction(event, platform, hasSelection);
	if (action !== null) return action;
	if (event.type !== "keydown" || event.keyCode !== IME_SENTINEL_KEYCODE) return null;
	const bytes = imeControlBytes(event);
	return bytes === null ? null : { write: bytes };
}
