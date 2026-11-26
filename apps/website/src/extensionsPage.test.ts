import { describe, expect, test } from "bun:test";
import { extensionCountLabel, matchesSearch, searchTerms } from "./extensionsPage";

describe("extension search", () => {
	test("splits a query into lowercase terms", () => {
		expect(searchTerms("  Weather  CARDS ")).toEqual(["weather", "cards"]);
		expect(searchTerms("   ")).toEqual([]);
	});

	test("matches when every term occurs, in any order", () => {
		const haystack = "weather thinkrail-ext-weather forecasts in chat. jane doe";
		expect(matchesSearch(haystack, [])).toBe(true);
		expect(matchesSearch(haystack, ["jane", "forecast"])).toBe(true);
		expect(matchesSearch(haystack, ["jane", "jira"])).toBe(false);
	});

	test("labels the count of shown extensions", () => {
		expect(extensionCountLabel(3, 3)).toBe("3 extensions");
		expect(extensionCountLabel(1, 1)).toBe("1 extension");
		expect(extensionCountLabel(1, 3)).toBe("1 of 3 extensions");
		expect(extensionCountLabel(0, 1)).toBe("0 of 1 extension");
	});
});
