import type { PanelHost } from "@thinkrail/extension-api/web";
import type {
	DayTimelineParams,
	DayTimelineQuery,
	DayTimelineResult,
	SessionsListScope,
} from "@thinkrail/pi-session-insights/core";
import { API_VERSION } from "../load";
import { VersionSkew } from "../session/api";

export const DAY_TIMELINE: DayTimelineQuery = "day.timeline";

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isDay(value: unknown): value is DayTimelineResult {
	return (
		isObject(value) &&
		value.apiVersion === API_VERSION &&
		Array.isArray(value.days) &&
		Array.isArray(value.sessions) &&
		Array.isArray(value.hours) &&
		isObject(value.sources)
	);
}

/** One host-local day of the scope's sessions; `day: null` asks for the latest day with a session. */
export async function loadDay(
	host: PanelHost,
	scope: SessionsListScope,
	day: string | null,
	signal: AbortSignal,
): Promise<DayTimelineResult> {
	const params: DayTimelineParams = day ? { scope, day } : { scope };
	const value = await host.query(DAY_TIMELINE, params, signal);
	if (!isDay(value)) throw new VersionSkew();
	return value;
}

/** The days before and after `day` that have sessions, for the day switcher. */
export function neighbours(
	days: readonly string[],
	day: string | null,
): { previous: string | null; next: string | null } {
	if (day === null) return { previous: null, next: null };
	let previous: string | null = null;
	let next: string | null = null;
	for (const candidate of days) {
		if (candidate < day) previous = candidate;
		else if (candidate > day && next === null) next = candidate;
	}
	return { previous, next };
}
