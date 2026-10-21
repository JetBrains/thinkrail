import { describe, expect, test } from "bun:test";
import {
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

test("the bundled English catalog passes its own validation", () => {
	const result = validateCatalog(EN);
	expect(result.ok && Object.keys(result.strings).length).toBe(Object.keys(EN).length);
});
