import { describe, expect, test } from "bun:test";
import { comparisonMarkdown, mermaidFence } from "./markdown.ts";

describe("mermaidFence", () => {
	test("wraps the source in a mermaid fence", () => {
		const out = mermaidFence(undefined, "graph LR; A-->B");
		expect(out).toContain("```mermaid");
		expect(out).toContain("graph LR; A-->B");
		expect(out.trimEnd().endsWith("```")).toBe(true);
	});

	test("puts the title as a heading before the fence", () => {
		const out = mermaidFence("Flow", "graph LR; A-->B");
		expect(out).toContain("Flow");
		expect(out.indexOf("Flow")).toBeLessThan(out.indexOf("```mermaid"));
	});

	test("trims surrounding whitespace from the source", () => {
		const out = mermaidFence(undefined, "\n  graph LR; A-->B  \n");
		expect(out).toContain("```mermaid\ngraph LR; A-->B\n```");
	});
});

describe("comparisonMarkdown", () => {
	const options = [
		{ name: "Option A", description: "First", pros: ["fast"], cons: ["pricey"] },
		{ name: "Option B", pros: ["cheap"], recommended: true },
	];

	test("renders each option name", () => {
		const out = comparisonMarkdown(undefined, options);
		expect(out).toContain("Option A");
		expect(out).toContain("Option B");
	});

	test("marks only the recommended option", () => {
		const out = comparisonMarkdown(undefined, options);
		const marker = "✅ Recommended";
		expect(out.split(marker).length - 1).toBe(1);
		expect(out.indexOf(marker)).toBeGreaterThan(out.indexOf("Option A"));
	});

	test("lists pros and cons as bullets", () => {
		const out = comparisonMarkdown(undefined, options);
		expect(out).toContain("- fast");
		expect(out).toContain("- pricey");
		expect(out).toContain("- cheap");
	});

	test("includes an inline mermaid fence when an option has one", () => {
		const out = comparisonMarkdown(undefined, [{ name: "Arch", mermaid: "graph TD; X-->Y" }]);
		expect(out).toContain("```mermaid");
		expect(out).toContain("graph TD; X-->Y");
	});

	test("puts the title as a heading before the first option", () => {
		const out = comparisonMarkdown("Choices", options);
		expect(out).toContain("Choices");
		expect(out.indexOf("Choices")).toBeLessThan(out.indexOf("Option A"));
	});
});
