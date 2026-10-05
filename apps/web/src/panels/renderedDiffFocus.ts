export const FOCUS_CONTEXT_BLOCKS = 2;
const MIN_HIDDEN_BLOCKS = 2;

export type FocusSegment<T> = { kind: "visible"; items: T[] } | { kind: "hidden"; items: T[] };

export function focusSegments<T>(
	items: readonly T[],
	isChanged: (item: T) => boolean,
	context = FOCUS_CONTEXT_BLOCKS,
): FocusSegment<T>[] {
	const visible = items.map(() => false);
	items.forEach((item, index) => {
		if (!isChanged(item)) return;
		const from = Math.max(0, index - context);
		const to = Math.min(items.length - 1, index + context);
		for (let i = from; i <= to; i++) visible[i] = true;
	});

	const segments: FocusSegment<T>[] = [];
	for (const [index, item] of items.entries()) {
		const kind = visible[index] ? "visible" : "hidden";
		const last = segments.at(-1);
		if (last?.kind === kind) last.items.push(item);
		else segments.push({ kind, items: [item] });
	}

	const merged: FocusSegment<T>[] = [];
	for (const segment of segments) {
		const keep = segment.kind === "hidden" && segment.items.length < MIN_HIDDEN_BLOCKS;
		const next: FocusSegment<T> = keep ? { kind: "visible", items: segment.items } : segment;
		const last = merged.at(-1);
		if (last?.kind === next.kind) last.items.push(...next.items);
		else merged.push(next);
	}
	return merged;
}
