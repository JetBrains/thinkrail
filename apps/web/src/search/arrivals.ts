import { type HostSearchInput, sameHostInput } from "./hostSearch";
import type { PaletteItem } from "./model";

export interface PinnedRow {
	readonly item: PaletteItem;
	readonly input: HostSearchInput;
}

export function withPinned(
	items: readonly PaletteItem[],
	pinned: PinnedRow | null,
	input: HostSearchInput,
): readonly PaletteItem[] {
	if (!pinned || !sameHostInput(pinned.input, input)) return items;
	return items.some((item) => item.id === pinned.item.id) ? items : [...items, pinned.item];
}

export interface Arrivals {
	readonly late: ReadonlyMap<string, number>;
	readonly cohort: number;
}

export const NO_ARRIVALS: Arrivals = { late: new Map(), cohort: 0 };

export function noteArrivals(
	arrivals: Arrivals,
	landed: readonly string[],
	onScreen: ReadonlySet<string>,
	holdingSelection: boolean,
): Arrivals {
	if (!holdingSelection) return arrivals;
	const fresh = landed.filter((id) => !onScreen.has(id) && !arrivals.late.has(id));
	if (fresh.length === 0) return arrivals;
	const cohort = arrivals.cohort + 1;
	const late = new Map(arrivals.late);
	for (const id of fresh) late.set(id, cohort);
	return { late, cohort };
}
