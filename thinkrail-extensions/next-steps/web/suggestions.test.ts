import { describe, expect, test } from "bun:test";
import { readSuggestions } from "./suggestions";

describe("readSuggestions", () => {
	test("prefers the tool's normalized result details", () => {
		expect(
			readSuggestions(
				{ suggestions: ["  raw  ", "raw"] },
				{ details: { suggestions: ["Run the tests"] } },
			),
		).toEqual(["Run the tests"]);
	});

	test("falls back to the call's arguments while there is no result", () => {
		expect(readSuggestions({ suggestions: ["Open a PR", 3, " "] }, undefined)).toEqual([
			"Open a PR",
		]);
	});

	test("reads nothing from malformed input", () => {
		expect(readSuggestions({}, { details: "nope" })).toEqual([]);
	});
});
