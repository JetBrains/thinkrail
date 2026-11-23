import type { SeriesKey } from "./model";

const ROLE_SERIES: readonly SeriesKey[] = [
	"series-6",
	"series-1",
	"series-2",
	"series-5",
	"series-7",
	"series-3",
	"series-4",
	"series-8",
];

/** A subagent role's colour: a stable hash of its name onto the categorical series. */
export function roleSeries(role: string | null): SeriesKey {
	if (!role) return "series-6";
	let hash = 0;
	for (let at = 0; at < role.length; at++) hash = (hash * 31 + role.charCodeAt(at)) >>> 0;
	return ROLE_SERIES[hash % ROLE_SERIES.length] ?? "series-6";
}
