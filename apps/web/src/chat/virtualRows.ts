import type { ChatMessageOrder } from "./chatPreferences";

export const CHAT_VIRTUAL_INDEX_ORIGIN = 1_000_000;

export interface VirtualRowsState<T extends { id: string }> {
	order: ChatMessageOrder;
	rows: T[];
	firstItemIndex: number;
}

export function initialVirtualRows<T extends { id: string }>(
	rows: T[],
	order: ChatMessageOrder,
): VirtualRowsState<T> {
	return {
		order,
		rows,
		firstItemIndex: order === "newest-first" ? CHAT_VIRTUAL_INDEX_ORIGIN : 0,
	};
}

function matchingRun(
	previousIds: readonly string[],
	previousStart: number,
	nextIds: readonly string[],
	nextStart: number,
): boolean {
	const overlap = Math.min(previousIds.length - previousStart, nextIds.length - nextStart);
	if (overlap <= 0) return false;
	for (let offset = 0; offset < overlap; offset += 1) {
		if (previousIds[previousStart + offset] !== nextIds[nextStart + offset]) return false;
	}
	return true;
}

export function advanceVirtualRows<T extends { id: string }>(
	previous: VirtualRowsState<T>,
	rows: T[],
	order: ChatMessageOrder,
	visibleAnchorId: string | null,
): VirtualRowsState<T> {
	if (order !== previous.order) return initialVirtualRows(rows, order);
	if (rows === previous.rows) return previous;
	if (order === "oldest-first" || previous.rows.length === 0 || rows.length === 0) {
		return { order, rows, firstItemIndex: order === "oldest-first" ? 0 : previous.firstItemIndex };
	}

	const previousIds = previous.rows.map((row) => row.id);
	const nextIds = rows.map((row) => row.id);
	const prepended = nextIds.indexOf(previousIds[0] ?? "");
	if (prepended >= 0 && matchingRun(previousIds, 0, nextIds, prepended)) {
		return { order, rows, firstItemIndex: previous.firstItemIndex - prepended };
	}
	const removed = previousIds.indexOf(nextIds[0] ?? "");
	if (removed >= 0 && matchingRun(previousIds, removed, nextIds, 0)) {
		return { order, rows, firstItemIndex: previous.firstItemIndex + removed };
	}
	if (visibleAnchorId) {
		const previousAnchor = previousIds.indexOf(visibleAnchorId);
		const nextAnchor = nextIds.indexOf(visibleAnchorId);
		if (previousAnchor >= 0 && nextAnchor >= 0) {
			return {
				order,
				rows,
				firstItemIndex: previous.firstItemIndex + previousAnchor - nextAnchor,
			};
		}
	}
	return { order, rows, firstItemIndex: previous.firstItemIndex };
}
