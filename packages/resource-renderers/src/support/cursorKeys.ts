import {
	ARROW_TWIN_COMMANDS,
	isImeComposing,
	type LocalKeyCommand,
	twinArrow,
} from "@thinkrail/ui/keyboard";
import { type LocalKeyEvent, type LocalKeys, useLocalKeys } from "@thinkrail/ui/local-keys";

type CursorDirection = "up" | "down" | "left" | "right";

export type CursorCommand =
	| { kind: "move"; direction: CursorDirection; extend: boolean }
	| { kind: "edge"; edge: "first" | "last"; extend: boolean }
	| { kind: "comment" }
	| { kind: "escape" };

export type CursorKeyEvent = LocalKeyEvent;

export type CursorKeys = Pick<LocalKeys, "match">;

export const REVIEW_SURFACE_SCOPE = "review.surface";

export const REVIEW_SURFACE_COMMANDS = [
	{ id: "review.surface.comment", chords: [{ code: "KeyM", key: "M", mod: true, shift: true }] },
	{
		id: "review.surface.saveDraft",
		chords: [
			{ code: "Enter", key: "↵", mod: true },
			{ code: "NumpadEnter", key: "Num ↵", mod: true },
		],
	},
	{
		id: "review.surface.sendNow",
		chords: [
			{ code: "Enter", key: "↵", mod: true, shift: true },
			{ code: "NumpadEnter", key: "Num ↵", mod: true, shift: true },
		],
	},
] as const satisfies readonly LocalKeyCommand[];

const REVIEW_SURFACE_KEYS: readonly LocalKeyCommand[] = [
	...REVIEW_SURFACE_COMMANDS,
	...ARROW_TWIN_COMMANDS,
];

export function useReviewSurfaceKeys(): LocalKeys {
	return useLocalKeys(REVIEW_SURFACE_SCOPE, REVIEW_SURFACE_KEYS);
}

const DIRECTIONS: Readonly<Record<string, CursorDirection>> = {
	ArrowUp: "up",
	ArrowDown: "down",
	ArrowLeft: "left",
	ArrowRight: "right",
};

export function cursorTwin(event: CursorKeyEvent, keys: CursorKeys): string | undefined {
	return twinArrow(keys.match(event, { ignoreShift: true }));
}

export function cursorCommand(event: CursorKeyEvent, keys: CursorKeys): CursorCommand | null {
	if (isImeComposing(event)) return null;
	if (keys.match(event) === "review.surface.comment") return { kind: "comment" };
	const twin = cursorTwin(event, keys);
	if (twin === undefined) {
		if (event.altKey || event.ctrlKey || event.metaKey) return null;
		if (event.key === "Enter") return event.shiftKey ? null : { kind: "comment" };
		if (event.key === "Escape") return { kind: "escape" };
		if (event.key === "Home" || event.key === "End") {
			return {
				kind: "edge",
				edge: event.key === "Home" ? "first" : "last",
				extend: event.shiftKey,
			};
		}
	}
	const direction = DIRECTIONS[twin ?? event.key];
	return direction ? { kind: "move", direction, extend: event.shiftKey } : null;
}

export function composerSubmit(event: CursorKeyEvent, keys: CursorKeys): "save" | "send" | null {
	const local = keys.match(event);
	return local === "review.surface.saveDraft"
		? "save"
		: local === "review.surface.sendNow"
			? "send"
			: null;
}
