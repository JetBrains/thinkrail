import { expect, test } from "bun:test";
import type { LocalLocalesSnapshot } from "@thinkrail/contracts";
import { BUNDLED_LOCALES, languageName } from "@thinkrail/locales";
import {
	availableLocales,
	effectiveLocale,
	type LanguageOption,
	languageOptions,
	localOverlays,
} from "./languages";

const snapshot: LocalLocalesSnapshot = {
	dir: "/data/locales",
	files: [
		{ fileName: "eo.json", tag: "eo", ok: true, strings: { "settings.language.title": "Lingvo" } },
		{ fileName: "en.json", tag: "en", ok: true, strings: { "settings.language.title": "Lingo" } },
		{
			fileName: "fr.json",
			tag: "fr",
			ok: false,
			error: "invalid-json",
			detail: "Unexpected token",
		},
	],
};

const builtin = (tag: string, source: "builtin" | "builtin+local" = "builtin"): LanguageOption => ({
	kind: "language",
	tag,
	name: languageName(tag),
	source,
});

const byName = (a: LanguageOption, b: LanguageOption) =>
	a.kind === "language" && b.kind === "language" ? a.name.localeCompare(b.name) : 0;

test("available languages are the bundled ones plus valid local files", () => {
	expect(BUNDLED_LOCALES[0]).toBe("en");
	expect(availableLocales(null)).toEqual([...BUNDLED_LOCALES]);
	expect(availableLocales(snapshot)).toEqual([...BUNDLED_LOCALES, "eo"]);
	expect(localOverlays(snapshot)).toEqual({
		eo: { "settings.language.title": "Lingvo" },
		en: { "settings.language.title": "Lingo" },
	});
});

test("options mark built-in, local, and customized languages, then broken files", () => {
	const languages = [
		{ kind: "language", tag: "eo", name: "Esperanto", source: "local" } as const,
		...BUNDLED_LOCALES.map((tag) => builtin(tag, tag === "en" ? "builtin+local" : "builtin")),
	].sort(byName);
	expect(languageOptions("system", snapshot)).toEqual([
		...languages,
		{
			kind: "broken",
			fileName: "fr.json",
			tag: "fr",
			error: "invalid-json",
			detail: "Unexpected token",
		},
	]);
	expect(languageOptions("system", null)).toEqual(
		BUNDLED_LOCALES.map((tag) => builtin(tag)).sort(byName),
	);
});

test("a selected language whose file is gone is listed as missing and renders English", () => {
	const options = languageOptions("tlh", snapshot);
	expect(options).toContainEqual({ kind: "missing", tag: "tlh" });
	expect(effectiveLocale("tlh", snapshot, ["eo"])).toBe("en");
	expect(languageOptions("fr", snapshot).some((option) => option.kind === "missing")).toBe(false);
});

test("system follows the browser languages over available catalogs", () => {
	expect(effectiveLocale("system", snapshot, ["eo-001", "en"])).toBe("eo");
	expect(effectiveLocale("system", null, ["eo-001"])).toBe("en");
	expect(effectiveLocale("eo", snapshot, ["en"])).toBe("eo");
});
