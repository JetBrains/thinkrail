import { SYSTEM_LOCALE } from "@thinkrail/locales";
import type { KeyValueStore } from "@thinkrail/remote-client";

export const THEME_CHOICES = ["system", "light", "dark"] as const;
export const CONTRAST_CHOICES = ["normal", "high"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];
export type ContrastChoice = (typeof CONTRAST_CHOICES)[number];

export interface DevicePreferences {
	theme: ThemeChoice;
	contrast: ContrastChoice;
	locale: string;
}

export const DEFAULT_PREFERENCES: DevicePreferences = {
	theme: "system",
	contrast: "normal",
	locale: SYSTEM_LOCALE,
};

const KEY = "thinkrail.preferences";

const oneOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T): T =>
	choices.find((choice) => choice === value) ?? fallback;

export function readPreferences(store: KeyValueStore): DevicePreferences {
	let raw: unknown = null;
	try {
		raw = JSON.parse(store.read(KEY) ?? "null");
	} catch {
		raw = null;
	}
	const saved = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
	return {
		theme: oneOf(THEME_CHOICES, saved.theme, DEFAULT_PREFERENCES.theme),
		contrast: oneOf(CONTRAST_CHOICES, saved.contrast, DEFAULT_PREFERENCES.contrast),
		locale: typeof saved.locale === "string" ? saved.locale : DEFAULT_PREFERENCES.locale,
	};
}

export function writePreferences(store: KeyValueStore, preferences: DevicePreferences): void {
	store.write(KEY, JSON.stringify(preferences));
}
