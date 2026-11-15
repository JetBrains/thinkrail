import type { ExtensionShortcutKey } from "@thinkrail/extension-api/web";
import { hasPlatformModifier, isImeComposing } from "@thinkrail/ui/keyboard";
import { letterOfCode } from "./labels";

export const HINT_KEYS = {
	show: { code: "KeyF", key: "f" },
	toggle: { code: "Semicolon", key: ";", mod: true },
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
	| { kind: "start" }
	| { kind: "exit" }
	| { kind: "undo" }
	| { kind: "letter"; letter: string; focusOnly: boolean }
	| { kind: "swallow" };

export interface HintKeyContext {
	active: boolean;
	platform: string;
	textEntry: boolean;
}

function isToggle(event: HintKeyEvent, platform: string): boolean {
	return (
		event.code === HINT_KEYS.toggle.code &&
		hasPlatformModifier(event, platform) &&
		!event.altKey &&
		!event.shiftKey
	);
}

function isShow(event: HintKeyEvent): boolean {
	return (
		event.code === HINT_KEYS.show.code &&
		!event.altKey &&
		!event.ctrlKey &&
		!event.metaKey &&
		!event.shiftKey
	);
}

export function hintKeyAction(
	event: HintKeyEvent,
	{ active, platform, textEntry }: HintKeyContext,
): HintKeyAction | null {
	if (isImeComposing(event)) return active ? { kind: "swallow" } : null;
	if (!active) {
		if (event.repeat) return null;
		if (isToggle(event, platform)) return { kind: "start" };
		return isShow(event) && !textEntry ? { kind: "start" } : null;
	}
	if (event.repeat) return { kind: "swallow" };
	if (isToggle(event, platform) || event.key === HINT_KEYS.exit.key) return { kind: "exit" };
	if (event.key === HINT_KEYS.undo.key) return { kind: "undo" };
	const letter = letterOfCode(event.code);
	if (letter !== null && !event.altKey && !event.ctrlKey && !event.metaKey) {
		return { kind: "letter", letter, focusOnly: event.shiftKey };
	}
	return { kind: "swallow" };
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
