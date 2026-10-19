import { describe, expect, test } from "bun:test";
import { fileSources, mermaidSources, validateShape } from "./validate.ts";

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

	test("accepts a file with a path and an optional before path", () => {
		expect(() => validateShape({ type: "file", path: "mock.html" })).not.toThrow();
		expect(() =>
			validateShape({ type: "file", path: "after.html", before: "before.html" }),
		).not.toThrow();
	});

	test("rejects a file without a path or with a blank before", () => {
		expect(() => validateShape({ type: "file" })).toThrow(/`path` is required/);
		expect(() => validateShape({ type: "file", path: " " })).toThrow(/`path` is required/);
		expect(() => validateShape({ type: "file", path: "a.html", before: "" })).toThrow(/`before`/);
	});
});

describe("sources", () => {
	test("a file contributes its paths and no mermaid", () => {
		const params = { type: "file" as const, path: "a.html", before: "b.html" };
		expect(fileSources(params)).toEqual([
			{ location: "path", path: "a.html" },
			{ location: "before", path: "b.html" },
		]);
		expect(mermaidSources(params)).toEqual([]);
		expect(fileSources({ type: "diagram", mermaid: "graph LR; A-->B" })).toEqual([]);
	});
});
