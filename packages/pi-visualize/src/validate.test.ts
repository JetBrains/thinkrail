import { describe, expect, test } from "bun:test";
import { validateShape } from "./validate.ts";

describe("validateShape", () => {
	test("accepts a diagram with mermaid", () => {
		expect(() => validateShape({ type: "diagram", mermaid: "graph LR; A-->B" })).not.toThrow();
	});

	test("rejects a diagram without mermaid", () => {
		expect(() => validateShape({ type: "diagram" })).toThrow(/mermaid/);
	});

	test("rejects a diagram with blank mermaid", () => {
		expect(() => validateShape({ type: "diagram", mermaid: "   " })).toThrow(/mermaid/);
	});

	test("accepts a comparison with named options", () => {
		expect(() =>
			validateShape({ type: "comparison", options: [{ name: "A" }, { name: "B" }] }),
		).not.toThrow();
	});

	test("rejects a comparison with no options", () => {
		expect(() => validateShape({ type: "comparison", options: [] })).toThrow(/options/);
	});

	test("rejects a comparison option missing a name", () => {
		expect(() => validateShape({ type: "comparison", options: [{ name: "" }] })).toThrow(/name/);
	});
});
