/** Host rows that landed while the user held a selection, by arrival cohort. */
export interface Arrivals {
	readonly late: ReadonlyMap<string, number>;
	readonly cohort: number;
}

export const NO_ARRIVALS: Arrivals = { late: new Map(), cohort: 0 };

/** While the user holds a selection, ids a reply brings that were not on screen join a new cohort. */
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
