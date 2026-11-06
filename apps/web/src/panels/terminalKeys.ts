import type { platformFamily } from "@/lib/utils";

export const SHIFT_ENTER_SEQUENCE = "\x1b\r";

export type TerminalKeyEvent = Pick<
	KeyboardEvent,
	"type" | "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>;

export type TerminalKeyAction = "copy" | "newline" | "swallow";

export function terminalKeyAction(
	event: TerminalKeyEvent,
	platform: ReturnType<typeof platformFamily>,
	hasSelection: boolean,
	shiftEnterNewline: boolean,
): TerminalKeyAction | null {
	if (event.type !== "keydown" && event.type !== "keypress") return null;
	if (event.altKey || event.metaKey) return null;
	if (event.key === "Enter" && event.shiftKey && !event.ctrlKey) {
		if (!shiftEnterNewline) return null;
		return event.type === "keydown" ? "newline" : "swallow";
	}
	if (event.type !== "keydown") return null;
	if (platform !== "apple" && event.ctrlKey && event.shiftKey && event.code === "KeyC") {
		return hasSelection ? "copy" : "swallow";
	}
	return null;
}
