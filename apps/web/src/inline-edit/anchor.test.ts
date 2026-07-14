import { expect, test } from "bun:test";
import { sourceLineRehype } from "./anchor";

// Minimal hast element with a remark position (as rehype provides via `node.position`).
function el(tagName: string, line: [number, number], children: unknown[] = []) {
	return {
		type: "element",
		tagName,
		properties: {},
		children,
		position: { start: { line: line[0] }, end: { line: line[1] } },
	};
}

test("sourceLineRehype stamps block elements with 1-based source line ranges", () => {
	const tree = {
		type: "root",
		children: [el("p", [3, 3]), el("h2", [5, 5])],
	};
	// biome-ignore lint/suspicious/noExplicitAny: test tree
	sourceLineRehype()(tree as any);
	const p = tree.children[0] as { properties: Record<string, unknown> };
	const h2 = tree.children[1] as { properties: Record<string, unknown> };
	expect(p.properties["data-md-line-start"]).toBe(3);
	expect(p.properties["data-md-line-end"]).toBe(3);
	expect(h2.properties["data-md-line-start"]).toBe(5);
});

test("sourceLineRehype skips nodes without a position", () => {
	const node = { type: "element", tagName: "p", properties: {}, children: [] };
	const tree = { type: "root", children: [node] };
	// biome-ignore lint/suspicious/noExplicitAny: test tree
	sourceLineRehype()(tree as any);
	expect(
		(node as { properties: Record<string, unknown> }).properties["data-md-line-start"],
	).toBeUndefined();
});
