/**
 * Message lookup.
 *
 * The message key IS the English source string. That is deliberate: the app's copy stays readable in
 * the components, a missing translation degrades to the English original instead of a blank or a
 * key-shaped placeholder, and adding a language needs no key registry kept in sync by hand.
 *
 * `t` is a plain function, not a React hook. It reads a locale that resolves once per page load and
 * only changes by reload (see `locale.ts`), so calling it from a component body, a module-level
 * constant, or a non-React helper is all equally safe — and no call site can violate the rules of
 * hooks by rendering conditionally.
 *
 * Placeholders are positional (`{0}`, `{1}`) so a translation can reorder them — Chinese routinely
 * puts the count or the noun somewhere else than English does.
 */
import { en } from "./catalogs/en";
import { zhCN } from "./catalogs/zh-CN";
import { getLocale, type Locale } from "./locale";

/**
 * Values interpolated into a message. Deliberately permissive: a template's `${…}` may be a value the
 * compiler still considers possibly-undefined (an indexed match, an optional field), and a missing
 * value must render as an empty string rather than the word "undefined".
 */
export type MessageArgs = readonly unknown[];
export type Catalog = Readonly<Record<string, string>>;

export const CATALOGS: Readonly<Record<Locale, Catalog>> = { en, "zh-CN": zhCN };

/** Substitutes `{n}` with the nth argument; an out-of-range placeholder is left as written. */
export function formatMessage(template: string, args?: MessageArgs): string {
	if (!args || args.length === 0) return template;
	return template.replace(/\{(\d+)\}/g, (match, index: string) => {
		const value = args[Number(index)];
		// A nullish value renders empty: an optional field or an unmatched index must not print
		// "undefined" into the interface. A placeholder with no argument at all stays as written.
		if (value === undefined && Number(index) >= args.length) return match;
		return value === undefined || value === null ? "" : String(value);
	});
}

/**
 * Resolve `key` in `locale`. A key the catalog does not carry falls back to the key itself, which is
 * the English source — so a partially translated catalog renders a mixed-language UI, never a broken one.
 */
export function translate(key: string, args?: MessageArgs, locale: Locale = getLocale()): string {
	return formatMessage(CATALOGS[locale]?.[key] ?? key, args);
}

/** The one entry point call sites use: `t("Add project")`, `t("Close {0}", name)`. */
export function t(key: string, ...args: MessageArgs): string {
	return translate(key, args);
}

/** Keys `locale` has no translation for — the per-locale gap behind `i18n-coverage`. */
export function untranslatedKeys(locale: Locale, keys: readonly string[]): string[] {
	if (locale === "en") return [];
	const catalog = CATALOGS[locale];
	return keys.filter((key) => catalog[key] === undefined || catalog[key] === key);
}
