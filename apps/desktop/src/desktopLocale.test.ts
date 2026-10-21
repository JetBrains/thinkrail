import { describe, expect, test } from "bun:test";
import { createDesktopLocaleSwitch } from "./desktopLocale";

function harness(initial: "en" | "zh-CN" = "en") {
	const writes: Array<[string, string]> = [];
	const installed: string[] = [];
	let acceptWrites = true;
	const localeSwitch = createDesktopLocaleSwitch(initial, {
		writePreference: (key, value) => {
			writes.push([key, value]);
			return acceptWrites;
		},
		installMenu: (locale) => {
			installed.push(locale);
			return true;
		},
	});
	return {
		localeSwitch,
		writes,
		installed,
		refuseWrites: () => {
			acceptWrites = false;
		},
	};
}

describe("createDesktopLocaleSwitch", () => {
	test("persists the language before rebuilding the menu", () => {
		const { localeSwitch, writes, installed } = harness();
		expect(localeSwitch.apply("zh-CN")).toBe("zh-CN");
		expect(writes).toEqual([["thinkrail-locale", "zh-CN"]]);
		expect(installed).toEqual(["zh-CN"]);
		expect(localeSwitch.locale).toBe("zh-CN");
	});

	test("folds a language tag onto the shipped locale", () => {
		const { localeSwitch, installed } = harness();
		expect(localeSwitch.apply("zh-Hans-CN")).toBe("zh-CN");
		expect(installed).toEqual(["zh-CN"]);
	});

	test("refuses a language this build does not speak without writing anything", () => {
		const { localeSwitch, writes, installed } = harness();
		expect(localeSwitch.apply("fr-FR")).toBeNull();
		expect(localeSwitch.apply(undefined)).toBeNull();
		expect(writes).toEqual([]);
		expect(installed).toEqual([]);
		expect(localeSwitch.locale).toBe("en");
	});

	test("keeps the menu in the old language when the preference cannot be stored", () => {
		const { localeSwitch, installed, refuseWrites } = harness();
		refuseWrites();
		expect(localeSwitch.apply("zh-CN")).toBeNull();
		expect(installed).toEqual([]);
		expect(localeSwitch.locale).toBe("en");
	});

	test("follows a write that already landed through the preference channel", () => {
		const { localeSwitch, writes, installed } = harness();
		expect(localeSwitch.follow("zh-CN")).toBe("zh-CN");
		expect(writes).toEqual([]);
		expect(installed).toEqual(["zh-CN"]);
		expect(localeSwitch.follow("fr-FR")).toBeNull();
		expect(localeSwitch.locale).toBe("zh-CN");
	});
});
