import {
	asStablePreferenceAdapter,
	getStablePreferenceAdapter,
	type StablePreferenceAdapter,
} from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";

export const FONT_KINDS = ["interface", "code", "terminal"] as const;
export type FontKind = (typeof FONT_KINDS)[number];
export type FontPreferences = Readonly<Record<FontKind, string>>;
export const DEFAULT_FONT_PREFERENCES: FontPreferences = {
	interface: "",
	code: "",
	terminal: "",
};
export const FONT_PREFERENCES_KEY = `${STORAGE_PREFIX}fonts-v1`;
export const FONT_NAME_MAX_LENGTH = 200;

export function normalizeFontName(value: unknown): string | null {
	if (typeof value !== "string" || /[\p{Cc},]/u.test(value)) return null;
	const name = value.trim();
	return name.length <= FONT_NAME_MAX_LENGTH ? name : null;
}

export function fontFamilyStack(name: string, fallback: string): string {
	return name ? `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}", ${fallback}` : fallback;
}

export function parseFontPreferences(raw: string | null): FontPreferences {
	try {
		const value: unknown = JSON.parse(raw ?? "null");
		if (typeof value !== "object" || value === null || Reflect.get(value, "version") !== 1) {
			return DEFAULT_FONT_PREFERENCES;
		}
		return {
			interface: normalizeFontName(Reflect.get(value, "interface")) ?? "",
			code: normalizeFontName(Reflect.get(value, "code")) ?? "",
			terminal: normalizeFontName(Reflect.get(value, "terminal")) ?? "",
		};
	} catch {
		return DEFAULT_FONT_PREFERENCES;
	}
}

function fontStorage(): StablePreferenceAdapter | null {
	try {
		return (
			getStablePreferenceAdapter() ??
			asStablePreferenceAdapter(Reflect.get(globalThis, "localStorage"))
		);
	} catch {
		return null;
	}
}

export function loadFontPreferences(storage: StablePreferenceAdapter | null): FontPreferences {
	try {
		return parseFontPreferences(storage?.getItem(FONT_PREFERENCES_KEY) ?? null);
	} catch {
		return DEFAULT_FONT_PREFERENCES;
	}
}

export function saveFontPreferences(
	storage: StablePreferenceAdapter | null,
	preferences: FontPreferences,
): boolean {
	if (!storage) return false;
	try {
		storage.setItem(FONT_PREFERENCES_KEY, JSON.stringify({ version: 1, ...preferences }));
		return true;
	} catch {
		return false;
	}
}

let preferences = DEFAULT_FONT_PREFERENCES;
let defaults: FontPreferences | undefined;
let revision = 0;
const listeners = new Set<() => void>();

export function getFontPreferences(): FontPreferences {
	return preferences;
}

export function subscribeFontPreferences(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

function applyPreferences(): void {
	if (!defaults) return;
	const root = document.documentElement;
	for (const kind of FONT_KINDS) {
		const token = `--tr-font-family-${kind}`;
		if (preferences[kind])
			root.style.setProperty(token, fontFamilyStack(preferences[kind], defaults[kind]));
		else root.style.removeProperty(token);
	}
	revision += 1;
	root.dataset.fonts = String(revision);
}

export function initializeFontPreferences(): void {
	if (defaults) return;
	const css = getComputedStyle(document.documentElement);
	defaults = {
		interface: css.getPropertyValue("--tr-font-family-interface").trim(),
		code: css.getPropertyValue("--tr-font-family-code").trim(),
		terminal: css.getPropertyValue("--tr-font-family-terminal").trim(),
	};
	preferences = loadFontPreferences(fontStorage());
	applyPreferences();
}

export function updateFontPreference(
	kind: FontKind,
	value: string,
): "saved" | "temporary" | "invalid" {
	const name = normalizeFontName(value);
	if (name === null) return "invalid";
	if (preferences[kind] !== name) {
		preferences = { ...preferences, [kind]: name };
		applyPreferences();
		for (const listener of listeners) listener();
	}
	return saveFontPreferences(fontStorage(), preferences) ? "saved" : "temporary";
}
