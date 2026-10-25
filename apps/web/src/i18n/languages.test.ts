import { expect, test } from "bun:test";
import type { LocalLocalesSnapshot } from "@thinkrail/contracts";
import { availableLocales, effectiveLocale, languageOptions, localOverlays } from "./languages";

const snapshot: LocalLocalesSnapshot = {
	dir: "/data/locales",
	files: [
		{ fileName: "de.json", tag: "de", ok: true, strings: { "settings.language.title": "Sprache" } },
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

test("available languages are the bundled ones plus valid local files", () => {
	expect(availableLocales(null)).toEqual(["en", "zh-CN"]);
	expect(availableLocales(snapshot)).toEqual(["en", "zh-CN", "de"]);
	expect(localOverlays(snapshot)).toEqual({
		de: { "settings.language.title": "Sprache" },
		en: { "settings.language.title": "Lingo" },
	});
});

test("options mark built-in, local, and customized languages, then broken files", () => {
	expect(languageOptions("system", snapshot)).toEqual([
		{ kind: "language", tag: "de", name: "Deutsch", source: "local" },
		{ kind: "language", tag: "en", name: "English", source: "builtin+local" },
		{ kind: "language", tag: "zh-CN", name: "中文（中国大陆）", source: "builtin" },
		{
			kind: "broken",
			fileName: "fr.json",
			tag: "fr",
			error: "invalid-json",
			detail: "Unexpected token",
		},
	]);
	expect(languageOptions("system", null)).toEqual([
		{ kind: "language", tag: "en", name: "English", source: "builtin" },
		{ kind: "language", tag: "zh-CN", name: "中文（中国大陆）", source: "builtin" },
	]);
});

test("a selected language whose file is gone is listed as missing and renders English", () => {
	const options = languageOptions("uk", snapshot);
	expect(options).toContainEqual({ kind: "missing", tag: "uk" });
	expect(effectiveLocale("uk", snapshot, ["de"])).toBe("en");
	expect(languageOptions("fr", snapshot).some((option) => option.kind === "missing")).toBe(false);
});

test("system follows the browser languages over available catalogs", () => {
	expect(effectiveLocale("system", snapshot, ["de-AT", "en"])).toBe("de");
	expect(effectiveLocale("system", null, ["de-AT"])).toBe("en");
	expect(effectiveLocale("de", snapshot, ["en"])).toBe("de");
});
