export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `text` is a real calendar date written `YYYY-MM-DD`. */
export function isIsoDate(text: string): boolean {
	const match = ISO_DATE.exec(text);
	if (!match) return false;
	const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
	return date.toISOString().slice(0, 10) === text;
}

/** Days since 1970-01-01 UTC of an ISO date's start. */
export function dayOfIso(iso: string): number {
	return Date.parse(`${iso}T00:00:00Z`) / DAY_MS;
}

/** The ISO date of a (fractional) day number, rounded down. */
export function isoOfDay(day: number): string {
	return new Date(Math.floor(day) * DAY_MS).toISOString().slice(0, 10);
}

/** Days since 1970-01-01 UTC, fractional. */
export function dayOf(ms: number): number {
	return ms / DAY_MS;
}

/** The start (UTC midnight) of the day holding `ms`, as a day number. */
export function today(ms: number): number {
	return Math.floor(ms / DAY_MS);
}

/** The start of the ISO week (Monday 00:00 UTC) holding `ms`, in ms. */
export function weekStart(ms: number): number {
	const day = Math.floor(ms / DAY_MS);
	const weekday = (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
	return (day - weekday) * DAY_MS;
}
