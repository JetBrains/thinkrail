import type { ExtensionCommand, ExtensionShortcutKey } from "@thinkrail/extension-api/web";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { letterOfCode } from "./labels";

export const SHOW_HINTS = {
	id: "hint-mode.show",
	title: "hintMode.shortcuts.show",
	chords: [
		{ code: "KeyF", key: "f" },
		{ code: "Semicolon", key: ";", mod: true },
	],
} as const satisfies ExtensionCommand;

export const HINT_KEYS = {
	focusOnly: { code: "ShiftLeft", key: "Shift" },
	undo: { code: "Backspace", key: "Backspace" },
	exit: { code: "Escape", key: "Escape" },
} as const satisfies Record<string, ExtensionShortcutKey>;

export type HintKeyEvent = Pick<
	KeyboardEvent,
	| "code"
	| "key"
	| "altKey"
	| "ctrlKey"
	| "metaKey"
	| "shiftKey"
	| "repeat"
	| "isComposing"
	| "keyCode"
>;

export type HintKeyAction =
	| { kind: "exit" }
	| { kind: "undo" }
	| { kind: "letter"; letter: string; focusOnly: boolean }
	| { kind: "swallow" };

export function hintKeyAction(event: HintKeyEvent, command: string | null): HintKeyAction {
	if (isImeComposing(event) || event.repeat) return { kind: "swallow" };
	if (event.key === HINT_KEYS.exit.key) return { kind: "exit" };
	if (event.key === HINT_KEYS.undo.key) return { kind: "undo" };
	const letter = letterOfCode(event.code);
	if (letter !== null && !event.altKey && !event.ctrlKey && !event.metaKey) {
		return { kind: "letter", letter, focusOnly: event.shiftKey };
	}
	return command === SHOW_HINTS.id ? { kind: "exit" } : { kind: "swallow" };
}

export type TypedLetter = { typed: string; chosen: number | null };

export function typeLetter(
	labels: readonly string[],
	typed: string,
	letter: string,
): TypedLetter | null {
	const next = typed + letter;
	if (!labels.some((label) => label.startsWith(next))) return null;
	const chosen = labels.indexOf(next);
	return { typed: next, chosen: chosen === -1 ? null : chosen };
}
