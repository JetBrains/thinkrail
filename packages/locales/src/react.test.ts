import { afterEach, expect, test } from "bun:test";
import { applyLocale, currentLocale, t } from "./react";

afterEach(() => applyLocale("en", {}));

test("renders English synchronously with no setup", () => {
	expect(t("desktop.menu.edit")).toBe("Edit");
	expect(currentLocale()).toBe("en");
});

test("a local overlay wins and missing strings fall back to English", () => {
	applyLocale("de", { de: { "desktop.menu.edit": "Bearbeiten" } });
	expect(currentLocale()).toBe("de");
	expect(t("desktop.menu.edit")).toBe("Bearbeiten");
	expect(t("desktop.menu.window")).toBe("Window");
});

test("a regional tag falls back through its base language overlay", () => {
	applyLocale("de-AT", { "de-AT": {}, de: { "desktop.menu.window": "Fenster" } });
	expect(t("desktop.menu.window")).toBe("Fenster");
});

test("re-applying without an overlay removes its strings", () => {
	applyLocale("de", { de: { "desktop.menu.edit": "Bearbeiten" } });
	applyLocale("de", {});
	expect(t("desktop.menu.edit")).toBe("Edit");
});

test("an English overlay customizes the bundled catalog and can be removed", () => {
	applyLocale("en", { en: { "desktop.menu.edit": "Editing" } });
	expect(t("desktop.menu.edit")).toBe("Editing");
	applyLocale("en", {});
	expect(t("desktop.menu.edit")).toBe("Edit");
});

test("<T> renders interpolated values as literal text, never as markup", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { T } = await import("./react");
	applyLocale("de", { de: { "settings.language.add.steps": "Lade <0>en.json</0> von {{base}}" } });
	const markup = renderToStaticMarkup(
		createElement(T, {
			i18nKey: "settings.language.add.steps",
			values: { base: "feature/<strong>main</strong> & co" },
			components: [createElement("a", { key: "a", href: "https://github.com/" })],
		}),
	);
	expect(markup).toBe(
		'Lade <a href="https://github.com/">en.json</a> von feature/&lt;strong&gt;main&lt;/strong&gt; &amp; co',
	);
});

test("prototype-named overlay keys never pollute objects", () => {
	applyLocale("de", { de: JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":"c"}') });
	expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	expect(t("desktop.menu.edit")).toBe("Edit");
});

test("useT hands out a new translator on every language or catalog change", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { useT } = await import("./react");
	const seen: unknown[] = [];
	const Probe = () => {
		const translate = useT();
		seen.push(translate);
		return translate("desktop.menu.edit");
	};
	expect(renderToStaticMarkup(createElement(Probe))).toBe("Edit");
	expect(renderToStaticMarkup(createElement(Probe))).toBe("Edit");
	applyLocale("de", { de: { "desktop.menu.edit": "Bearbeiten" } });
	expect(renderToStaticMarkup(createElement(Probe))).toBe("Bearbeiten");
	applyLocale("de", { de: { "desktop.menu.edit": "Ändern" } });
	expect(renderToStaticMarkup(createElement(Probe))).toBe("Ändern");
	expect(seen[0]).toBe(seen[1]);
	expect(new Set(seen).size).toBe(3);
});

test("an attributed tag from a local file never reaches <T>: the code-owned href stays", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { T } = await import("./react");
	const { validateCatalog } = await import("./index");
	const local = validateCatalog({
		"settings.language.add.steps": 'Lade <0 href="https://attacker.example/<0>">en.json</0>',
	});
	applyLocale("de", { de: local.ok ? local.strings : {} });
	const markup = renderToStaticMarkup(
		createElement(T, {
			i18nKey: "settings.language.add.steps",
			components: [createElement("a", { key: "a", href: "https://github.com/" })],
		}),
	);
	expect(markup).toContain('href="https://github.com/"');
	expect(markup).not.toContain("attacker");
});

test("resolution walks exactly tag → base → English, never an unlisted script fallback", () => {
	applyLocale("zh-Hant-TW", {
		"zh-Hant": { "desktop.menu.edit": "編輯 (Hant)" },
		zh: { "desktop.menu.edit": "编辑" },
	});
	expect(t("desktop.menu.edit")).toBe("编辑");
});

test("localeOf names the language a translator was issued for", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { localeOf, useT } = await import("./react");
	const Probe = () => localeOf(useT());
	applyLocale("de", {});
	expect(renderToStaticMarkup(createElement(Probe))).toBe("de");
	applyLocale("en", {});
	expect(renderToStaticMarkup(createElement(Probe))).toBe("en");
});

test("interpolation can never complete a tag: a value-built attributed tag is rejected before <T>", async () => {
	const { createElement } = await import("react");
	const { renderToStaticMarkup } = await import("react-dom/server");
	const { T } = await import("./react");
	const { validateCatalog } = await import("./index");
	const local = validateCatalog({
		"shell.location.branch.fromBase": '· von <0>{{base}}</0><{{base}} title="injected"/>',
		"lib.compactAge.underHour": "<1 год",
	});
	expect(local.ok && Object.keys(local.strings)).toEqual(["lib.compactAge.underHour"]);
	applyLocale("de", { de: local.ok ? local.strings : {} });
	const markup = renderToStaticMarkup(
		createElement(T, {
			i18nKey: "shell.location.branch.fromBase",
			values: { base: "0" },
			components: [createElement("code", { key: "c" })],
		}),
	);
	expect(markup).toBe("· from <code>0</code>");
});

test("plural forms follow the language's own rules, with or without the number", () => {
	applyLocale("ru", {
		ru: {
			"tools.read.firstLines_one": "первая {{count}} строка",
			"tools.read.firstLines_few": "первые {{count}} строки",
			"tools.read.firstLines_many": "первые {{count}} строк",
		},
	});
	expect([1, 2, 5, 21].map((count) => t("tools.read.firstLines", { count }))).toEqual([
		"первая 1 строка",
		"первые 2 строки",
		"первые 5 строк",
		"первая 21 строка",
	]);
	applyLocale("ar", {
		ar: {
			"changes.review.end_zero": "لا ملفات",
			"changes.review.end_one": "ملف واحد",
			"changes.review.end_two": "ملفان",
			"changes.review.end_other": "{{count}} ملفات",
		},
	});
	expect([0, 1, 2, 7].map((count) => t("changes.review.end", { count }))).toEqual([
		"لا ملفات",
		"ملف واحد",
		"ملفان",
		"7 ملفات",
	]);
});

test("a partly translated counter stays in its language instead of falling back to English", () => {
	applyLocale("ru", { ru: { "tools.read.firstLines_other": "первые {{count}} строк" } });
	expect(t("tools.read.firstLines", { count: 3 })).toBe("первые 3 строк");
	applyLocale("ja", { ja: { "tools.read.firstLines_other": "最初の{{count}}行" } });
	expect([1, 4].map((count) => t("tools.read.firstLines", { count }))).toEqual([
		"最初の1行",
		"最初の4行",
	]);
});
