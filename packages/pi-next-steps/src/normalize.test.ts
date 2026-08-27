import { describe, expect, test } from "bun:test";
import { fallbackText, normalizeItems, readOfferedItems } from "./normalize.ts";
import { MAX_LABEL_LENGTH, MAX_PROMPT_LENGTH } from "./schema.ts";

const item = (label: string, prompt: string) => ({ label, prompt });

describe("normalizeItems", () => {
	test("trims label and prompt", () => {
		expect(normalizeItems([item("  Run the tests  ", "\tRun the e2e suite.\n")])).toEqual([
			item("Run the tests", "Run the e2e suite."),
		]);
	});

	test("accepts up to three items and keeps the authored order", () => {
		const items = normalizeItems([item("A", "do a"), item("B", "do b"), item("C", "do c")]);
		expect(items.map((i) => i.label)).toEqual(["A", "B", "C"]);
	});

	test("rejects an empty list — zero suggestions means no call at all", () => {
		expect(() => normalizeItems([])).toThrow(/at least one suggestion/);
	});

	test("rejects a fourth item", () => {
		expect(() =>
			normalizeItems([item("A", "a"), item("B", "b"), item("C", "c"), item("D", "d")]),
		).toThrow(/at most 3/);
	});

	test("rejects a non-array", () => {
		expect(() => normalizeItems(undefined)).toThrow(/must be an array/);
	});

	test("rejects a blank or non-string label", () => {
		expect(() => normalizeItems([item("   ", "do it")])).toThrow(/items\[0\].label/);
		expect(() => normalizeItems([{ label: 7, prompt: "do it" }])).toThrow(/items\[0\].label/);
	});

	test("rejects a blank or missing prompt", () => {
		expect(() => normalizeItems([item("A", "  ")])).toThrow(/items\[0\].prompt/);
		expect(() => normalizeItems([{ label: "A" }])).toThrow(/items\[0\].prompt/);
	});

	test("rejects a label over the length limit, measured after trimming", () => {
		expect(() => normalizeItems([item(` ${"x".repeat(MAX_LABEL_LENGTH)} `, "ok")])).not.toThrow();
		expect(() => normalizeItems([item("x".repeat(MAX_LABEL_LENGTH + 1), "ok")])).toThrow(
			/items\[0\].label is 61 characters/,
		);
	});

	test("rejects a prompt over the length limit", () => {
		expect(() => normalizeItems([item("A", "x".repeat(MAX_PROMPT_LENGTH))])).not.toThrow();
		expect(() => normalizeItems([item("A", "x".repeat(MAX_PROMPT_LENGTH + 1))])).toThrow(
			/items\[0\].prompt is 501 characters/,
		);
	});

	test("rejects duplicate labels case-insensitively", () => {
		expect(() => normalizeItems([item("Run tests", "a"), item("run TESTS", "b")])).toThrow(
			/items\[1\].label repeats/,
		);
	});

	test("rejects duplicate prompts case-insensitively", () => {
		expect(() => normalizeItems([item("A", "Run the suite"), item("B", "run the SUITE")])).toThrow(
			/items\[1\].prompt repeats/,
		);
	});

	test("every rejection names the tool so the model can correct itself", () => {
		expect(() => normalizeItems([])).toThrow(/^offer_next_steps: /);
	});
});

describe("readOfferedItems", () => {
	test("reads a normalized details payload", () => {
		expect(readOfferedItems({ items: [item("A", "do a")] })).toEqual([item("A", "do a")]);
	});

	test("returns null for a details payload that no longer validates", () => {
		expect(readOfferedItems(null)).toBeNull();
		expect(readOfferedItems({})).toBeNull();
		expect(readOfferedItems({ items: [] })).toBeNull();
		expect(readOfferedItems({ items: [{ label: "A" }] })).toBeNull();
		expect(readOfferedItems("items")).toBeNull();
	});
});

describe("fallbackText", () => {
	test("renders a readable numbered list", () => {
		expect(
			fallbackText([item("Run tests", "Run the e2e suite."), item("Ship", "Open a PR.")]),
		).toBe(`Offered 2 optional next step(s); the user may pick one:
1. Run tests — Run the e2e suite.
2. Ship — Open a PR.`);
	});
});
