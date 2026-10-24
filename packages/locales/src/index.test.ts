import { describe, expect, test } from "bun:test";
import {
	BUNDLED_LOCALES,
	bundledCatalog,
	completePlurals,
	EN,
	fallbackChain,
	languageName,
	localeTagFromFileName,
	resolveLocale,
	validateCatalog,
} from "./index";

describe("localeTagFromFileName", () => {
	test("canonicalizes BCP-47 file names", () => {
		expect(localeTagFromFileName("de.json")).toBe("de");
		expect(localeTagFromFileName("pt-br.json")).toBe("pt-BR");
		expect(localeTagFromFileName("zh-Hant-TW.json")).toBe("zh-Hant-TW");
	});

	test("rejects non-language names", () => {
		expect(localeTagFromFileName("notes.txt")).toBeNull();
		expect(localeTagFromFileName(".de.json")).toBeNull();
		expect(localeTagFromFileName("my translation.json")).toBeNull();
		expect(localeTagFromFileName("x.json")).toBeNull();
	});
});

describe("validateCatalog", () => {
	test("rejects a non-object root", () => {
		expect(validateCatalog([]).ok).toBe(false);
		expect(validateCatalog("hi").ok).toBe(false);
		expect(validateCatalog(null).ok).toBe(false);
	});

	test("keeps strings, drops non-strings, keeps unknown keys", () => {
		const result = validateCatalog({
			"desktop.menu.edit": "Bearbeiten",
			"desktop.menu.window": 3,
			"future.key": "Zukunft",
		});
		expect(result).toEqual({
			ok: true,
			strings: { "desktop.menu.edit": "Bearbeiten", "future.key": "Zukunft" },
		});
	});

	test("drops a known string whose placeholders differ from English", () => {
		const result = validateCatalog({ "desktop.menu.quit": "{{app}} beenden" });
		expect(result).toEqual({ ok: true, strings: {} });
	});
});

describe("resolveLocale", () => {
	const available = ["en", "de", "pt-BR"];

	test("system walks browser languages: exact, then base", () => {
		expect(resolveLocale("system", available, ["fr-FR", "pt-BR"])).toBe("pt-BR");
		expect(resolveLocale("system", available, ["de-AT"])).toBe("de");
		expect(resolveLocale("system", available, ["ja"])).toBe("en");
	});

	test("an explicit tag is used only when available", () => {
		expect(resolveLocale("de", available, ["ja"])).toBe("de");
		expect(resolveLocale("uk", available, ["de"])).toBe("en");
	});
});

test("fallbackChain dedupes tag, base, English", () => {
	expect(fallbackChain("pt-BR")).toEqual(["pt-BR", "pt", "en"]);
	expect(fallbackChain("en")).toEqual(["en"]);
});

test("languageName uses the language's own name", () => {
	expect(languageName("de")).toBe("Deutsch");
	expect(languageName("en")).toBe("English");
	expect(languageName("zh-Hans")).toBe("简体中文");
});

describe("validateCatalog hardening", () => {
	test("drops markup that differs from English or carries attributes", () => {
		const result = validateCatalog({
			"settings.language.add.steps": 'Get <0 href="https://attacker.example">en.json</0> now',
			"desktop.menu.edit": "<b>Bearbeiten</b>",
			"future.key": "<0>ok</0>",
			"future.plain": "plain",
		});
		expect(result).toEqual({ ok: true, strings: { "future.plain": "plain" } });
	});

	test("a quoted attribute that hides a marker is still an attributed tag", () => {
		const result = validateCatalog({
			"settings.language.add.steps": 'Get <0 href="https://attacker.example/<0>">en.json</0>',
			"future.comment": "a <!-- note --> b",
			"future.single": "<0 title='x'>y</0>",
		});
		expect(result).toEqual({ ok: true, strings: {} });
	});

	test("drops i18next nesting so fragments cannot be assembled into markup", () => {
		const result = validateCatalog({ "desktop.menu.edit": "$t(future.open)", "future.open": "<0" });
		expect(result.ok && Object.keys(result.strings)).toEqual(["future.open"]);
	});

	test("keeps markup that matches English indexed tags", () => {
		const result = validateCatalog({
			"settings.language.add.steps": "Lade <0>en.json</0> herunter und übersetze die Werte.",
		});
		expect(result.ok && Object.keys(result.strings)).toEqual(["settings.language.add.steps"]);
	});

	test("a bare angle bracket in prose is text, not markup", () => {
		const result = validateCatalog({
			"lib.compactAge.underHour": "<1 год",
			"future.math": "a < b",
		});
		expect(result.ok && Object.keys(result.strings).sort()).toEqual([
			"future.math",
			"lib.compactAge.underHour",
		]);
	});

	test("drops empty strings so English shows through", () => {
		expect(validateCatalog({ "desktop.menu.edit": "" })).toEqual({ ok: true, strings: {} });
	});

	test("inherited property names are ordinary unknown keys", () => {
		const raw = JSON.parse(
			'{"constructor":"a","toString":"b","__proto__":"c","hasOwnProperty":"d"}',
		);
		const result = validateCatalog(raw);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(Object.getPrototypeOf(result.strings)).toBe(Object.prototype);
		expect(Object.hasOwn(result.strings, "__proto__")).toBe(true);
		expect(Reflect.get(result.strings, "constructor")).toBe("a");
	});
});

test("every bundled catalog covers all English keys in sorted order and passes validation", () => {
	expect(BUNDLED_LOCALES).toEqual(["en", "zh-Hans"]);
	const enKeys = Object.keys(EN);
	for (const locale of BUNDLED_LOCALES) {
		const catalog = bundledCatalog(locale);
		expect(catalog).toBeDefined();
		if (!catalog) continue;
		expect(Object.keys(catalog)).toEqual(enKeys);
		const result = validateCatalog(catalog);
		expect(result.ok && Object.keys(result.strings).length).toBe(enKeys.length);
	}
});

describe("plural forms", () => {
	test("any plural form may show or omit the number; other placeholders stay strict", () => {
		const result = validateCatalog({
			"tools.read.firstLines_one": "первая {{count}} строка",
			"tools.read.firstLines_few": "первые {{count}} строки",
			"tools.read.firstLines_many": "первые {{count}} строк",
			"changes.review.end_zero": "نهاية التغييرات · لا ملفات",
			"changes.review.end_one": "نهاية التغييرات · ملف واحد",
			"mcp.entries.notReference_few": "{{labels}} — не ссылки.",
		});
		expect(result.ok && Object.keys(result.strings).sort()).toEqual([
			"changes.review.end_one",
			"changes.review.end_zero",
			"tools.read.firstLines_few",
			"tools.read.firstLines_many",
			"tools.read.firstLines_one",
		]);
	});

	test("a translated family gets every form its language needs from its own other form", () => {
		const completed = completePlurals("ru", {
			"tools.read.firstLines_one": "первая {{count}} строка",
			"tools.read.firstLines_other": "первые {{count}} строк",
			"desktop.menu.edit": "Правка",
		});
		expect(completed).toEqual({
			"tools.read.firstLines_one": "первая {{count}} строка",
			"tools.read.firstLines_other": "первые {{count}} строк",
			"tools.read.firstLines_few": "первые {{count}} строк",
			"tools.read.firstLines_many": "первые {{count}} строк",
			"desktop.menu.edit": "Правка",
		});
	});

	test("a family with only a singular form fills the rest from it; non-families are left alone", () => {
		expect(completePlurals("de", { "tools.read.firstLines_one": "erste Zeile" })).toEqual({
			"tools.read.firstLines_one": "erste Zeile",
			"tools.read.firstLines_other": "erste Zeile",
		});
		expect(completePlurals("ru", { "future.key_one": "x" })).toEqual({ "future.key_one": "x" });
	});
});

test("no catalog placeholder is named like an i18next option, which t() would consume instead", () => {
	const reserved = new Set(["context", "ordinal", "lng", "lngs", "ns", "defaultValue", "replace"]);
	const clashes = Object.entries(EN).flatMap(([key, value]) =>
		[...value.matchAll(/\{\{\s*-?\s*([^\s,}]+)/g)]
			.map((match) => match[1] ?? "")
			.filter((name) => reserved.has(name))
			.map((name) => `${key}: ${name}`),
	);
	expect(clashes).toEqual([]);
});
