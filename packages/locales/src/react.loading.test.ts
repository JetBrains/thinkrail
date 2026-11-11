import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import * as locales from "./index";

const { bundledCatalog, loadBundledCatalog } = locales;
const unloaded = new Set<string>();
const failing = new Set<string>();
const loads: string[] = [];

mock.module("./index", () => ({
	...locales,
	bundledCatalog: (tag: string) => (unloaded.has(tag) ? undefined : bundledCatalog(tag)),
	loadBundledCatalog: async (tag: string) => {
		loads.push(tag);
		if (failing.has(tag)) throw new Error(`chunk ${tag}`);
		unloaded.delete(tag);
		return loadBundledCatalog(tag);
	},
}));

const { applyLocale, currentLocale, t } = await import("./react");

beforeEach(() => {
	unloaded.add("ru");
	failing.add("ru");
});

afterEach(() => {
	unloaded.clear();
	failing.clear();
	loads.length = 0;
	return applyLocale("en", {});
});

test("a failed translation rejects and leaves English rendering as the current language", async () => {
	await expect(applyLocale("ru", {})).rejects.toThrow("chunk ru");
	expect(currentLocale()).toBe("en");
	expect(t("desktop.menu.edit")).toBe("Edit");
});

test("a failed translation keeps its local overlay as the current language", async () => {
	await expect(applyLocale("ru", { ru: { "desktop.menu.edit": "Правка" } })).rejects.toThrow(
		"chunk ru",
	);
	expect(currentLocale()).toBe("ru");
	expect(t("desktop.menu.edit")).toBe("Правка");
});

test("a failed translation with an empty local overlay renders English as the current language", async () => {
	await expect(applyLocale("ru", { ru: {} })).rejects.toThrow("chunk ru");
	expect(currentLocale()).toBe("en");
	expect(t("desktop.menu.edit")).toBe("Edit");
});

test("after a failure, other languages apply and a later pick of it retries", async () => {
	await expect(applyLocale("ru", {})).rejects.toThrow("chunk ru");
	await applyLocale("en", {});
	await applyLocale("de", { de: { "desktop.menu.edit": "Bearbeiten" } });
	expect(loads).toEqual(["ru"]);
	failing.clear();
	await applyLocale("ru", {});
	expect(currentLocale()).toBe("ru");
	expect(t("desktop.menu.edit")).toBe("Правка");
	expect(loads).toEqual(["ru", "ru"]);
});

test("an overlay outside the fallback chain applies at once, without loading its bundled catalog", async () => {
	unloaded.add("ja");
	const applied = applyLocale("en", { ja: { "desktop.menu.edit": "編集" } });
	expect(currentLocale()).toBe("en");
	await applied;
	expect(t("desktop.menu.edit")).toBe("Edit");
	expect(loads).toEqual([]);
});

test("a newer apply wins over one still loading its catalog", async () => {
	unloaded.add("zh-CN");
	const first = applyLocale("zh-CN", {});
	const second = applyLocale("de", { de: { "desktop.menu.edit": "Bearbeiten" } });
	expect(currentLocale()).toBe("de");
	await Promise.all([first, second]);
	expect(loads).toEqual(["zh-CN"]);
	expect(currentLocale()).toBe("de");
	expect(t("desktop.menu.edit")).toBe("Bearbeiten");
});
