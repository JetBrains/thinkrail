/**
 * Locale resolution for the web client.
 *
 * The client ships English source copy as the message key (see `translate.ts`), so a locale only
 * decides *which* catalog overlays that copy. A locale the app cannot speak falls back to English by
 * omission rather than by error: an untranslated key renders its English source string.
 *
 * The locale resolves once, at module load, from the persisted preference (the native stable adapter,
 * then `localStorage`), then the browser's `navigator.language`, then `DEFAULT_LOCALE`. Changing it
 * persists and then *reloads* rather than re-rendering: copy is read by module-level constants, the
 * native menu, and `document` metadata as well as by components, and a reload is the only way they all
 * agree. That keeps `t` a plain function with no subscription and no rules-of-hooks exposure.
 */
import { getStablePreferenceAdapter } from "../clientPreferences";

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];

/** The copy this build ships with. Everything else is an opt-in overlay. */
export const DEFAULT_LOCALE: Locale = "en";

/** Shown in the language picker, each in its own language. */
export const LOCALE_LABELS: Readonly<Record<Locale, string>> = {
	en: "English",
	"zh-CN": "简体中文",
};

const PREFERENCE_KEY = "thinkrail-locale";
const LOCAL_STORAGE_KEY = "thinkrail.locale";

function isLocale(value: unknown): value is Locale {
	return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** `zh-Hans-CN`, `zh_CN`, `ZH` and friends all resolve to `zh-CN`; `en-*` to `en`; else `null`. */
export function normalizeLocale(tag: string | null | undefined): Locale | null {
	if (!tag) return null;
	const lower = tag.toLowerCase();
	if (lower.startsWith("zh")) return "zh-CN";
	if (lower.startsWith("en")) return "en";
	return null;
}

/** The persisted choice, if the user made one. */
export function storedLocale(): Locale | null {
	const stable = getStablePreferenceAdapter();
	const fromStable = stable?.getItem(PREFERENCE_KEY) ?? null;
	if (isLocale(fromStable)) return fromStable;
	const normalized = normalizeLocale(fromStable);
	if (normalized) return normalized;
	try {
		return normalizeLocale(globalThis.localStorage?.getItem(LOCAL_STORAGE_KEY) ?? null);
	} catch {
		return null;
	}
}

function detect(): Locale {
	const browser =
		typeof navigator === "undefined"
			? null
			: (navigator.language ?? navigator.languages?.[0] ?? null);
	return storedLocale() ?? normalizeLocale(browser) ?? DEFAULT_LOCALE;
}

let resolved: Locale | null = null;

/** The active locale. Computed once per page load. */
export function getLocale(): Locale {
	resolved ??= detect();
	return resolved;
}

/** Persist an explicit choice. Takes effect on the next load — call `applyLocale` to switch now. */
export function setLocale(locale: Locale): void {
	resolved = locale;
	try {
		getStablePreferenceAdapter()?.setItem(PREFERENCE_KEY, locale);
	} catch {
		/* the adapter is optional */
	}
	try {
		globalThis.localStorage?.setItem(LOCAL_STORAGE_KEY, locale);
	} catch {
		/* storage may be unavailable (private mode, embedded webview) */
	}
}

/**
 * Persist `locale` and reload, so components, module-level copy, `document` metadata and the native
 * menu all come up in the new language together. Falls back to a plain assignment when there is no
 * document to reload (tests, SSR).
 */
export function applyLocale(locale: Locale): void {
	setLocale(locale);
	if (typeof location !== "undefined" && typeof location.reload === "function") location.reload();
}

/** Test seam: drop the resolved value so the next `getLocale()` re-detects. */
export function resetLocaleCache(): void {
	resolved = null;
}
