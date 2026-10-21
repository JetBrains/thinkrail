/**
 * Locale resolution for the web client.
 *
 * The client ships English source copy as the message key (see `translate.ts`), so a locale only
 * decides *which* catalog overlays that copy. A locale the app cannot speak falls back to English by
 * omission rather than by error: an untranslated key renders its English source string.
 *
 * The locale resolves once, at module load, from the persisted preference (`localStorage` first, then
 * the native stable adapter), then the browser's `navigator.language`, then `DEFAULT_LOCALE`. Changing
 * it persists and then *reloads* rather than re-rendering: copy is read by module-level constants, the
 * native menu, and `document` metadata as well as by components, and a reload is the only way they all
 * agree. That keeps `t` a plain function with no subscription and no rules-of-hooks exposure.
 */
import { getNativeLocaleAdapter, getStablePreferenceAdapter } from "../clientPreferences";

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

/**
 * The persisted choice, if the user made one.
 *
 * `localStorage` outranks the native adapter on purpose. The adapter is seeded from a snapshot the
 * desktop injects into the preload script when the window is created, so it cannot see a choice made
 * during this session — a reload would replay the stale snapshot and undo the switch. `localStorage`
 * is written synchronously by `setLocale`, survives the reload, and is scoped to this launch because
 * the desktop client is served from a fresh loopback port every time. The adapter is still the fallback
 * so a choice persisted in an earlier launch is honoured before `navigator.language`.
 */
export function storedLocale(): Locale | null {
	try {
		const stored = normalizeLocale(globalThis.localStorage?.getItem(LOCAL_STORAGE_KEY) ?? null);
		if (stored) return stored;
	} catch {
		/* storage may be unavailable (private mode, embedded webview) */
	}
	const fromStable = getStablePreferenceAdapter()?.getItem(PREFERENCE_KEY) ?? null;
	if (isLocale(fromStable)) return fromStable;
	return normalizeLocale(fromStable);
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
 *
 * In the desktop client the reload is held until the native side has written the preference and
 * rebuilt its menu: the preload script re-runs on reload and would otherwise re-seed the old value.
 * A failed handshake still reloads, because `localStorage` already carries the choice for this
 * session; it only means the next launch falls back to the previous language.
 */
export function applyLocale(locale: Locale): void {
	setLocale(locale);
	const reload = () => {
		if (typeof location !== "undefined" && typeof location.reload === "function") location.reload();
	};
	const native = getNativeLocaleAdapter();
	if (!native) {
		reload();
		return;
	}
	void native
		.applyLocale(locale)
		.catch(() => false)
		.then(reload);
}

/** Test seam: drop the resolved value so the next `getLocale()` re-detects. */
export function resetLocaleCache(): void {
	resolved = null;
}
