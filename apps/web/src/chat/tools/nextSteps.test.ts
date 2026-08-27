import { describe, expect, test } from "bun:test";
import { readNextStepItems } from "./nextSteps";

const raw = (items: unknown) => ({ content: [{ type: "text", text: "…" }], details: { items } });

describe("readNextStepItems", () => {
	test("reads the completed result's validated details, not the tool arguments", () => {
		expect(
			readNextStepItems(raw([{ label: " Run tests ", prompt: " Run the e2e suite. " }])),
		).toEqual([{ label: "Run tests", prompt: "Run the e2e suite." }]);
	});

	test("rejects an item count outside the one-to-three contract", () => {
		expect(readNextStepItems(raw([]))).toEqual([]);
		expect(
			readNextStepItems(
				raw([
					{ label: "a", prompt: "a" },
					{ label: "b", prompt: "b" },
					{ label: "c", prompt: "c" },
					{ label: "d", prompt: "d" },
				]),
			),
		).toEqual([]);
	});

	test("reads nothing from a shape it cannot trust", () => {
		expect(readNextStepItems(undefined)).toEqual([]);
		expect(readNextStepItems("text")).toEqual([]);
		expect(readNextStepItems({ content: [] })).toEqual([]);
		expect(readNextStepItems(raw(undefined))).toEqual([]);
		expect(readNextStepItems(raw([{ label: "a" }]))).toEqual([]);
		expect(readNextStepItems(raw([{ label: "  ", prompt: "a" }]))).toEqual([]);
		expect(readNextStepItems(raw([{ label: "a", prompt: 7 }]))).toEqual([]);
	});

	test("one bad item discards the whole offer rather than rendering a partial row", () => {
		expect(readNextStepItems(raw([{ label: "a", prompt: "a" }, { label: "b" }]))).toEqual([]);
	});

	test("rejects overlong or case-insensitively duplicated fields", () => {
		expect(readNextStepItems(raw([{ label: "x".repeat(61), prompt: "a" }]))).toEqual([]);
		expect(readNextStepItems(raw([{ label: "a", prompt: "x".repeat(501) }]))).toEqual([]);
		expect(
			readNextStepItems(
				raw([
					{ label: "Run tests", prompt: "Run the suite" },
					{ label: "run TESTS", prompt: "Open the report" },
				]),
			),
		).toEqual([]);
		expect(
			readNextStepItems(
				raw([
					{ label: "Run tests", prompt: "Run the suite" },
					{ label: "Open report", prompt: "run THE SUITE" },
				]),
			),
		).toEqual([]);
	});
});
