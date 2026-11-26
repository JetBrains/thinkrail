import { describe, expect, test } from "bun:test";
import { isRefused, readSuggestions } from "./suggestions";

describe("readSuggestions", () => {
	test("prefers the tool's normalized result details", () => {
		expect(
			readSuggestions(
				{ suggestions: ["  raw  ", "raw"] },
				{ details: { suggestions: ["Run the tests"] } },
			),
		).toEqual(["Run the tests"]);
	});

	test("falls back to the call's arguments while there is no result, each string once", () => {
		expect(readSuggestions({ suggestions: ["Open a PR", 3, " ", "Open a PR"] }, undefined)).toEqual(
			["Open a PR"],
		);
	});

	test("reads nothing from malformed input", () => {
		expect(readSuggestions({}, { details: "nope" })).toEqual([]);
	});

	test("a refused call offers nothing, even though its arguments hold suggestions", () => {
		const refused = { details: { suggestions: [], refused: true } };
		expect(readSuggestions({ suggestions: ["Open a PR"] }, refused)).toEqual([]);
		expect([isRefused(refused), isRefused({ details: { suggestions: ["Open a PR"] } })]).toEqual([
			true,
			false,
		]);
	});
});
