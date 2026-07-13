import { expect, test } from "bun:test";
import { buildSeedPrompt } from "./prompt";

const target = {
	workspaceId: "w",
	path: "docs/architecture.md",
	text: "A fatal fault takes the host down.",
	startLine: 12,
	endLine: 12,
	rect: { top: 0, left: 0, bottom: 0, right: 0 },
};

test("seed prompt names the file, the line range, the quoted selection, and the instruction", () => {
	const p = buildSeedPrompt(target, "soften this");
	expect(p).toContain("docs/architecture.md");
	expect(p).toContain("lines 12-12");
	expect(p).toContain("A fatal fault takes the host down.");
	expect(p).toContain("soften this");
});

test("seed prompt states the guardrails (edit tools only, no questions, one-line why)", () => {
	const p = buildSeedPrompt(target, "x").toLowerCase();
	expect(p).toContain("edit"); // use your edit/write tools
	expect(p).toContain("do not ask"); // no clarifying questions
	expect(p).toContain("one"); // end with one short sentence
});
