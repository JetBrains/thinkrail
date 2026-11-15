import { hasPlatformModifier, isImeComposing } from "@thinkrail/ui/keyboard";

type CursorDirection = "up" | "down" | "left" | "right";

export type CursorCommand =
	| { kind: "move"; direction: CursorDirection; extend: boolean }
	| { kind: "edge"; edge: "first" | "last"; extend: boolean }
	| { kind: "comment" }
	| { kind: "escape" };

export type CursorKeyEvent = Pick<
	KeyboardEvent,
	"key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "isComposing" | "keyCode"
>;

const ARROWS: Readonly<Record<string, CursorDirection>> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

const LETTERS: Readonly<Record<string, CursorDirection>> = {
	h: "left",
	j: "down",
	k: "up",
	l: "right",
};

const COMMENT_KEY = "m";

function cursorDirection(key: string): CursorDirection | null {
	return ARROWS[key] ?? LETTERS[key.toLowerCase()] ?? null;
}

export function cursorCommand(event: CursorKeyEvent, platform?: string): CursorCommand | null {
	if (isImeComposing(event) || event.altKey) return null;
	if (event.ctrlKey || event.metaKey) {
		return event.shiftKey &&
			event.key.toLowerCase() === COMMENT_KEY &&
			hasPlatformModifier(event, platform)
			? { kind: "comment" }
			: null;
	}
	if (event.key === "Enter") return event.shiftKey ? null : { kind: "comment" };
	if (event.key === "Escape") return { kind: "escape" };
	if (event.key === "Home" || event.key === "End") {
		return { kind: "edge", edge: event.key === "Home" ? "first" : "last", extend: event.shiftKey };
	}
	const direction = cursorDirection(event.key);
	return direction ? { kind: "move", direction, extend: event.shiftKey } : null;
}

export function composerSubmit(
	event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey">,
): "save" | "send" | null {
	if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return null;
	return event.shiftKey ? "send" : "save";
}
