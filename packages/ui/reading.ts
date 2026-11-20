import { revealDelta } from "./focus";
import { isImeComposing, type LocalKeyCommand, twinArrow } from "./keyboard";
import type { LocalKeyEvent, LocalKeys } from "./local-keys";

export const READING_LINE = 40;

export type ReadingDirection = -1 | 1;

export const READING_SCOPE = "reading";

export const READING_COMMANDS = [
	{ id: "reading.top", edge: -1, chords: [{ code: "KeyG", key: "G" }] },
	{ id: "reading.bottom", edge: 1, chords: [{ code: "KeyG", key: "G", shift: true }] },
] as const satisfies readonly (LocalKeyCommand & { readonly edge: ReadingDirection })[];

const READING_EDGES: ReadonlyMap<string, ReadingDirection> = new Map(
	READING_COMMANDS.map(({ id, edge }) => [id, edge]),
);

export type ReadingCommand =
	| { kind: "line"; direction: ReadingDirection }
	| { kind: "side"; direction: ReadingDirection }
	| { kind: "page"; direction: ReadingDirection }
	| { kind: "edge"; direction: ReadingDirection };

const PLAIN_KEYS: Readonly<Record<string, ReadingCommand>> = {
	ArrowUp: { kind: "line", direction: -1 },
	ArrowDown: { kind: "line", direction: 1 },
	ArrowLeft: { kind: "side", direction: -1 },
	ArrowRight: { kind: "side", direction: 1 },
	PageUp: { kind: "page", direction: -1 },
	PageDown: { kind: "page", direction: 1 },
	Home: { kind: "edge", direction: -1 },
	End: { kind: "edge", direction: 1 },
};

export function readingCommand(
	event: LocalKeyEvent,
	keys: Pick<LocalKeys, "match">,
	local: string | null = keys.match(event),
): ReadingCommand | null {
	if (isImeComposing(event)) return null;
	const edge = local === null ? undefined : READING_EDGES.get(local);
	if (edge !== undefined) return { kind: "edge", direction: edge };
	const twin = twinArrow(local);
	if (twin !== undefined) return PLAIN_KEYS[twin] ?? null;
	if (local !== null || event.altKey || event.ctrlKey || event.metaKey) return null;
	if (event.key === " ") return { kind: "page", direction: event.shiftKey ? -1 : 1 };
	return event.shiftKey ? null : (PLAIN_KEYS[event.key] ?? null);
}

export function readingPage(viewport: number): number {
	return Math.max(READING_LINE, viewport - READING_LINE);
}

export interface ReadingSpan {
	readonly top: number;
	readonly bottom: number;
}

export function spansOverlap(span: ReadingSpan, view: ReadingSpan): boolean {
	return span.bottom > view.top + 1 && span.top < view.bottom - 1;
}

export function scrollBeforeStep(
	view: ReadingSpan,
	item: ReadingSpan,
	direction: ReadingDirection,
	line = READING_LINE,
): number {
	const rest = direction > 0 ? item.bottom - view.bottom : view.top - item.top;
	return rest > 1 ? direction * Math.min(line, rest) : 0;
}

export function stepRevealDelta(view: ReadingSpan, item: ReadingSpan, line = READING_LINE): number {
	if (item.bottom - item.top <= view.bottom - view.top) return revealDelta(view, item);
	if (item.top > view.bottom - line) return item.top + line - view.bottom;
	if (item.bottom < view.top + line) return item.bottom - line - view.top;
	return 0;
}

export interface ReadingScroll {
	readonly scrollTop: number;
	readonly scrollLeft: number;
	readonly clientHeight: number;
	readonly clientWidth: number;
	readonly scrollHeight: number;
	readonly scrollWidth: number;
}

function clamp(value: number, max: number): number {
	return Math.min(Math.max(0, max), Math.max(0, value));
}

export function readingScrollTarget(
	command: ReadingCommand,
	scroll: ReadingScroll,
): { top: number; left: number } {
	const maxTop = scroll.scrollHeight - scroll.clientHeight;
	const { direction } = command;
	switch (command.kind) {
		case "line":
			return {
				top: clamp(scroll.scrollTop + direction * READING_LINE, maxTop),
				left: scroll.scrollLeft,
			};
		case "page":
			return {
				top: clamp(scroll.scrollTop + direction * readingPage(scroll.clientHeight), maxTop),
				left: scroll.scrollLeft,
			};
		case "edge":
			return { top: direction < 0 ? 0 : clamp(maxTop, maxTop), left: scroll.scrollLeft };
		case "side":
			return {
				top: scroll.scrollTop,
				left: clamp(
					scroll.scrollLeft + direction * READING_LINE,
					scroll.scrollWidth - scroll.clientWidth,
				),
			};
	}
}

export function scrollReading(scroller: HTMLElement, command: ReadingCommand): void {
	const { top, left } = readingScrollTarget(command, scroller);
	scroller.scrollTop = top;
	scroller.scrollLeft = left;
}
