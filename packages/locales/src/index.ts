import en from "../en.json";
import es from "../es.json";
import ja from "../ja.json";
import ru from "../ru.json";
import zhCN from "../zh-CN.json";

export type Catalog = Readonly<Record<string, string>>;
export type EnglishCatalog = typeof en;

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const PLURAL_KEY = /^(.+)_(zero|one|two|few|many|other)$/;

export type MessageKey = keyof EnglishCatalog extends infer K
	? K extends `${infer Base}_${"zero" | "one" | "two" | "few" | "many" | "other"}`
		? Base
		: K
	: never;

export const EN: Catalog = en;

export const SYSTEM_LOCALE = "system";

/** Keys the desktop app renders in its native menu; the web pushes their translations to it. */
export const DESKTOP_MENU_KEYS = [
	"desktop.menu.edit",
	"desktop.menu.settings",
	"desktop.menu.quit",
	"desktop.menu.window",
	"desktop.menu.close",
] as const satisfies readonly (keyof EnglishCatalog)[];

export const DESKTOP_DIALOG_KEYS = [
	"desktop.dialog.quit",
	"desktop.dialog.startFailed",
	"desktop.dialog.updateRestartFailed",
	"desktop.dialog.updateRestartFailedTitle",
	"desktop.splash.finishingUpdate",
	"desktop.splash.starting",
] as const satisfies readonly (keyof EnglishCatalog)[];

const BUNDLED: Readonly<Record<string, Catalog>> = { en: EN, es, ja, ru, "zh-CN": zhCN };

export const BUNDLED_LOCALES: readonly string[] = Object.keys(BUNDLED);

export function bundledCatalog(tag: string): Catalog | undefined {
	return BUNDLED[tag];
}

export function canonicalLocale(tag: string): string | null {
	try {
		return Intl.getCanonicalLocales(tag)[0] ?? null;
	} catch {
		return null;
	}
}

export function localeTagFromFileName(name: string): string | null {
	if (name.startsWith(".") || !name.endsWith(".json")) return null;
	const stem = name.slice(0, -".json".length);
	if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(stem)) return null;
	return canonicalLocale(stem);
}

export function baseLanguage(tag: string): string {
	return tag.split("-")[0]?.toLowerCase() ?? tag;
}

export function fallbackChain(tag: string): string[] {
	return [...new Set([tag, baseLanguage(tag), "en"])];
}

export function languageName(tag: string): string {
	let name: string | undefined;
	try {
		name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
	} catch {
		name = undefined;
	}
	if (!name) return tag;
	return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
}

function placeholders(text: string, ignoreCount: boolean): string {
	const names = new Set<string>();
	for (const match of text.matchAll(/\{\{\s*([^\s,}]+)[^}]*\}\}/g)) {
		if (match[1] && !(ignoreCount && match[1] === "count")) names.add(match[1]);
	}
	if (/\{\{(?![^{}]*\}\})/.test(text)) names.add("{{");
	return [...names].sort().join("\u0000");
}

const PARSED_TAG = /<!--[\s\S]*?-->|<[a-zA-Z0-9\-!/](?:"[^"]*"|'[^']*'|[^'">])*>/g;
const BARE_MARKER = /^<\/?\d+\/?>$/;

function markup(text: string): string | null {
	const tags: string[] = [];
	for (const match of text.matchAll(PARSED_TAG)) {
		if (!BARE_MARKER.test(match[0])) return null;
		tags.push(match[0]);
	}
	return tags.sort().join("\u0000");
}

function own(catalog: Catalog, key: string): string | undefined {
	return Object.hasOwn(catalog, key) ? catalog[key] : undefined;
}

function englishReference(key: string): string | undefined {
	if (!PLURAL_SUFFIX.test(key)) return own(EN, key);
	const base = key.replace(PLURAL_SUFFIX, "");
	return own(EN, `${base}_other`) ?? own(EN, key) ?? own(EN, base);
}

function acceptable(key: string, value: string): boolean {
	if (value === "" || value.includes("$t(") || /<\s*\/?\s*\{\{/.test(value)) return false;
	const shape = markup(value);
	if (shape === null) return false;
	const reference = englishReference(key);
	if (reference === undefined) return shape === "";
	const plural = PLURAL_SUFFIX.test(key);
	return (
		placeholders(reference, plural) === placeholders(value, plural) && markup(reference) === shape
	);
}

function pluralCategories(tag: string): readonly string[] {
	try {
		return new Intl.PluralRules(tag).resolvedOptions().pluralCategories;
	} catch {
		return [];
	}
}

export function completePlurals(tag: string, strings: Catalog): Catalog {
	const families = new Map<string, Map<string, string>>();
	for (const [key, value] of Object.entries(strings)) {
		const match = PLURAL_KEY.exec(key);
		if (!match?.[1] || !match[2] || own(EN, `${match[1]}_other`) === undefined) continue;
		const forms = families.get(match[1]) ?? new Map<string, string>();
		forms.set(match[2], value);
		families.set(match[1], forms);
	}
	if (families.size === 0) return strings;
	const categories = pluralCategories(tag);
	const completed: Record<string, string> = { ...strings };
	for (const [base, forms] of families) {
		const source = forms.get("other") ?? forms.values().next().value;
		if (source === undefined) continue;
		for (const category of categories) {
			if (!forms.has(category)) completed[`${base}_${category}`] = source;
		}
	}
	return completed;
}

export type CatalogValidation = { ok: true; strings: Catalog } | { ok: false; error: "not-object" };

export function validateCatalog(raw: unknown): CatalogValidation {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, error: "not-object" };
	}
	const entries = Object.entries(raw).filter(
		(entry): entry is [string, string] =>
			typeof entry[1] === "string" && acceptable(entry[0], entry[1]),
	);
	return { ok: true, strings: Object.fromEntries(entries) };
}

function scriptKey(tag: string): string | null {
	try {
		const locale = new Intl.Locale(tag).maximize();
		return locale.script ? `${locale.language}-${locale.script}` : locale.language;
	} catch {
		return null;
	}
}

function matchAvailable(tag: string, available: readonly string[]): string | undefined {
	const lower = tag.toLowerCase();
	const exact = available.find((candidate) => candidate.toLowerCase() === lower);
	if (exact) return exact;
	const base = baseLanguage(tag);
	const byBase = available.find((candidate) => candidate.toLowerCase() === base);
	if (byBase) return byBase;
	const key = scriptKey(tag);
	if (key === null) return undefined;
	return available.find((candidate) => scriptKey(candidate) === key);
}

export function resolveLocale(
	preference: string,
	available: readonly string[],
	systemLanguages: readonly string[],
): string {
	if (preference !== SYSTEM_LOCALE) {
		const lower = preference.toLowerCase();
		return available.find((candidate) => candidate.toLowerCase() === lower) ?? "en";
	}
	for (const language of systemLanguages) {
		const match = matchAvailable(language, available);
		if (match) return match;
	}
	return "en";
}
