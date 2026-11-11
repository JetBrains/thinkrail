export interface Arrivals {
	readonly late: ReadonlyMap<string, number>;
	readonly cohort: number;
	readonly listed: ReadonlySet<string>;
}

export const NO_ARRIVALS: Arrivals = { late: new Map(), cohort: 0, listed: new Set() };

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
	return a.size === b.size && [...a].every((id) => b.has(id));
}

export function noteArrivals(
	arrivals: Arrivals,
	landed: readonly string[],
	onScreen: ReadonlySet<string>,
	holdingSelection: boolean,
): Arrivals {
	const listed = new Set(landed);
	const fresh = holdingSelection
		? landed.filter((id) => !onScreen.has(id) && !arrivals.listed.has(id) && !arrivals.late.has(id))
		: [];
	if (fresh.length === 0) {
		return sameIds(arrivals.listed, listed) ? arrivals : { ...arrivals, listed };
	}
	const cohort = arrivals.cohort + 1;
	const late = new Map(arrivals.late);
	for (const id of fresh) late.set(id, cohort);
	return { late, cohort, listed };
}
