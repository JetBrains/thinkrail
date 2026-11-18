import type { Translator } from "@thinkrail/locales/react";

const numberFormats = new Map<string, Intl.NumberFormat>();
const dateFormats = new Map<string, Intl.DateTimeFormat>();

function numberFormat(
	locale: string,
	name: string,
	options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
	const key = `${locale}\u0000${name}`;
	let format = numberFormats.get(key);
	if (!format) {
		format = new Intl.NumberFormat(locale, options);
		numberFormats.set(key, format);
	}
	return format;
}

function dateFormat(
	locale: string,
	name: string,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = `${locale}\u0000${name}`;
	let format = dateFormats.get(key);
	if (!format) {
		format = new Intl.DateTimeFormat(locale, options);
		dateFormats.set(key, format);
	}
	return format;
}

export function formatCount(locale: string, value: number): string {
	return numberFormat(locale, "count", { maximumFractionDigits: 0 }).format(value);
}

/** A file size in the locale's short units (bytes, kB, MB), one decimal past a kilobyte. */
export function formatBytes(locale: string, bytes: number): string {
	const [unit, value] =
		bytes >= 1024 * 1024
			? (["megabyte", bytes / (1024 * 1024)] as const)
			: bytes >= 1024
				? (["kilobyte", bytes / 1024] as const)
				: (["byte", bytes] as const);
	return numberFormat(locale, `bytes:${unit}`, {
		style: "unit",
		unit,
		unitDisplay: "short",
		maximumFractionDigits: unit === "byte" ? 0 : 1,
	}).format(value);
}

export function formatTokens(locale: string, value: number): string {
	if (Math.abs(value) < 1000) return formatCount(locale, value);
	return numberFormat(locale, "compact", {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

const MIN_SHOWN_COST = 0.001;

export function formatCost(locale: string, value: number): string {
	if (value === 0)
		return numberFormat(locale, "cost0", {
			style: "currency",
			currency: "USD",
			maximumFractionDigits: 0,
		}).format(0);
	const small = Math.abs(value) < 0.01;
	const format = numberFormat(locale, small ? "costSmall" : "cost", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: small ? 3 : 2,
	});
	if (value > 0 && value < MIN_SHOWN_COST) return `<${format.format(MIN_SHOWN_COST)}`;
	return format.format(value);
}

export function formatCostExact(locale: string, value: number): string {
	return numberFormat(locale, "costExact", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 2,
		maximumFractionDigits: 6,
	}).format(value);
}

export function formatShare(locale: string, part: number, whole: number): string | null {
	if (whole <= 0) return null;
	return numberFormat(locale, "share", { style: "percent", maximumFractionDigits: 0 }).format(
		part / whole,
	);
}

export function formatStart(locale: string, ms: number, now: number): string {
	if (new Date(ms).getFullYear() !== new Date(now).getFullYear())
		return dateFormat(locale, "startDate", {
			day: "numeric",
			month: "short",
			year: "numeric",
		}).format(ms);
	return dateFormat(locale, "start", {
		day: "numeric",
		month: "short",
		hour: "2-digit",
		minute: "2-digit",
	}).format(ms);
}

export function formatDateTime(locale: string, ms: number): string {
	return dateFormat(locale, "dateTime", { dateStyle: "long", timeStyle: "medium" }).format(ms);
}

export function formatDuration(t: Translator, ms: number, exact = false): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	const totalHours = Math.floor(totalSeconds / 3600);
	if (totalHours >= 48)
		return t("sessionInsights.duration.daysHours", {
			days: Math.floor(totalHours / 24),
			hours: totalHours % 24,
		});
	const hours = totalHours;
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	if (exact) {
		if (hours > 0)
			return t("sessionInsights.duration.hoursMinutesSeconds", { hours, minutes, seconds });
		if (minutes > 0) return t("sessionInsights.duration.minutesSeconds", { minutes, seconds });
		return t("sessionInsights.duration.seconds", { seconds });
	}
	if (hours > 0) return t("sessionInsights.duration.hoursMinutes", { hours, minutes });
	if (minutes > 0) return t("sessionInsights.duration.minutes", { minutes });
	return t("sessionInsights.duration.seconds", { seconds });
}

/** A call's duration at the resolution it needs: milliseconds, then tenths of seconds, then minutes. */
export function formatSpan(t: Translator, locale: string, ms: number): string {
	if (ms < 1000)
		return t("sessionInsights.duration.milliseconds", { ms: formatCount(locale, Math.round(ms)) });
	if (ms < 60_000)
		return t("sessionInsights.duration.secondsPrecise", {
			seconds: numberFormat(locale, "tenths", { maximumFractionDigits: 1 }).format(ms / 1000),
		});
	return formatDuration(t, ms);
}

export function formatClock(locale: string, ms: number, seconds: boolean): string {
	return dateFormat(locale, seconds ? "clockSeconds" : "clock", {
		hour: "2-digit",
		minute: "2-digit",
		...(seconds ? { second: "2-digit" } : {}),
	}).format(ms);
}

export function formatDay(locale: string, ms: number): string {
	return dateFormat(locale, "day", { day: "numeric", month: "short" }).format(ms);
}

/** A share as a percent; positive shares under half a percent read "<1%". */
export function formatPercent(locale: string, share: number, digits = 0): string {
	const format = numberFormat(locale, `percent${digits}`, {
		style: "percent",
		maximumFractionDigits: digits,
		minimumFractionDigits: digits,
	});
	if (share > 0 && share < 0.005 && digits === 0) return `<${format.format(0.01)}`;
	return format.format(share);
}

/** A signed number with at most `digits` decimals: "+3", "−0.25". */
export function formatSigned(locale: string, value: number, digits = 2): string {
	const text = numberFormat(locale, `signed${digits}`, { maximumFractionDigits: digits }).format(
		Math.abs(value),
	);
	return value > 0 ? `+${text}` : value < 0 ? `−${text}` : `±${text}`;
}
