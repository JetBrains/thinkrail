/** Persisted, browser-local cadence for the in-app permission preface. */
export interface PromptStorage {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
}

const SNOOZE_KEY = "thinkrail.notifications.snoozeUntil";
export const SNOOZE_DAYS = 7;
const SNOOZE_MS = SNOOZE_DAYS * 24 * 60 * 60 * 1000;

function defaultStorage(): PromptStorage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** True while a "Not now" snooze is still in effect. */
export function isPromptSnoozed(now: number = Date.now(), storage = defaultStorage()): boolean {
	if (!storage) return false;
	const raw = storage.getItem(SNOOZE_KEY);
	if (raw === null) return false;
	const until = Number(raw);
	return Number.isFinite(until) && until > now;
}

/** Record a "Not now": suppress the preface for the next {@link SNOOZE_DAYS} days. */
export function snoozePrompt(now: number = Date.now(), storage = defaultStorage()): void {
	storage?.setItem(SNOOZE_KEY, String(now + SNOOZE_MS));
}

export function clearPromptSnooze(storage = defaultStorage()): void {
	storage?.removeItem(SNOOZE_KEY);
}
