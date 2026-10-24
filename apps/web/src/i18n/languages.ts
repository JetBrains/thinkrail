import type { LocalLocaleFileErrorCode, LocalLocalesSnapshot } from "@thinkrail/contracts";
import {
	BUNDLED_LOCALES,
	type Catalog,
	languageName,
	resolveLocale,
	SYSTEM_LOCALE,
} from "@thinkrail/locales";

export type LanguageSource = "builtin" | "local" | "builtin+local";

export type LanguageOption =
	| { kind: "language"; tag: string; name: string; source: LanguageSource }
	| {
			kind: "broken";
			fileName: string;
			tag: string | null;
			error: LocalLocaleFileErrorCode;
			detail?: string;
	  }
	| { kind: "missing"; tag: string };

function localTags(snapshot: LocalLocalesSnapshot | null): string[] {
	return (snapshot?.files ?? []).flatMap((file) => (file.ok ? [file.tag] : []));
}

export function availableLocales(snapshot: LocalLocalesSnapshot | null): string[] {
	return [...new Set([...BUNDLED_LOCALES, ...localTags(snapshot)])];
}

export function localOverlays(snapshot: LocalLocalesSnapshot | null): Record<string, Catalog> {
	return Object.fromEntries(
		(snapshot?.files ?? []).flatMap((file) => (file.ok ? [[file.tag, file.strings]] : [])),
	);
}

export function effectiveLocale(
	preference: string,
	snapshot: LocalLocalesSnapshot | null,
	systemLanguages: readonly string[],
): string {
	return resolveLocale(preference, availableLocales(snapshot), systemLanguages);
}

export function languageOptions(
	preference: string,
	snapshot: LocalLocalesSnapshot | null,
): LanguageOption[] {
	const local = new Set(localTags(snapshot));
	const languages: LanguageOption[] = availableLocales(snapshot)
		.map((tag): LanguageOption => {
			const bundled = BUNDLED_LOCALES.includes(tag);
			const source: LanguageSource =
				bundled && local.has(tag) ? "builtin+local" : bundled ? "builtin" : "local";
			return { kind: "language", tag, name: languageName(tag), source };
		})
		.sort((a, b) =>
			a.kind === "language" && b.kind === "language" ? a.name.localeCompare(b.name) : 0,
		);
	const broken: LanguageOption[] = (snapshot?.files ?? []).flatMap((file) =>
		file.ok
			? []
			: [
					{
						kind: "broken" as const,
						fileName: file.fileName,
						tag: file.tag,
						error: file.error,
						...(file.detail ? { detail: file.detail } : {}),
					},
				],
	);
	const known = new Set([
		...availableLocales(snapshot).map((tag) => tag.toLowerCase()),
		...broken.flatMap((option) =>
			option.kind === "broken" && option.tag ? [option.tag.toLowerCase()] : [],
		),
	]);
	const missing: LanguageOption[] =
		preference !== SYSTEM_LOCALE && !known.has(preference.toLowerCase())
			? [{ kind: "missing", tag: preference }]
			: [];
	return [...languages, ...missing, ...broken];
}
