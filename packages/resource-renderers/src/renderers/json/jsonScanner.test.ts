import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import { jsonRenderer } from ".";
import { jsonNodeDraft, jsonNodeOfAnchor, scanJson } from "./jsonScanner";

test("JSON scanner records nested object and array source ranges by RFC 6901 pointer", () => {
	const document = scanJson(
		["{", '  "a": {', '    "b": [', "      1,", '      { "c": true }', "    ]", "  }", "}"].join(
			"\n",
		),
	);
	expect(document).not.toBeNull();
	expect(document?.nodes.get("/a")).toMatchObject({ startLine: 2, endLine: 7 });
	expect(document?.nodes.get("/a/b")).toMatchObject({ startLine: 3, endLine: 6 });
	expect(document?.nodes.get("/a/b/0")).toMatchObject({ startLine: 4, endLine: 4, value: 1 });
	expect(document?.nodes.get("/a/b/1/c")).toMatchObject({
		startLine: 5,
		endLine: 5,
		value: true,
	});
});

test("JSON pointers escape slash and tilde segments", () => {
	const document = scanJson('{ "a/b": { "~key": 1 } }');
	expect(document?.nodes.get("/a~1b/~0key")?.value).toBe(1);
});

test("JSONC comments and trailing commas parse without changing source positions", () => {
	const document = scanJson('{\n  // note\n  "a": 1,\n  "b": [2,],\n}\n');
	expect(document?.value).toEqual({ a: 1, b: [2] });
	expect(document?.nodes.get("/a")).toMatchObject({ startLine: 3, endLine: 3 });
	expect(document?.nodes.get("/b/0")).toMatchObject({ startLine: 4, endLine: 4 });
});

test("the scanner names the dialect it needed: strict JSON stays json, comments or trailing commas are jsonc", () => {
	expect(scanJson('{"a": [1, 2]}')?.dialect).toBe("json");
	expect(scanJson('{"a": 1 // note\n}')?.dialect).toBe("jsonc");
	expect(scanJson("/* c */ [1]")?.dialect).toBe("jsonc");
	expect(scanJson('{"a": 1,}')?.dialect).toBe("jsonc");
	expect(scanJson("[1, 2,]")?.dialect).toBe("jsonc");
	expect(scanJson("{broken")).toBeNull();
});

test("duplicate keys resolve to the last source node", () => {
	const document = scanJson('{\n  "same": 1,\n  "same": { "value": 2 }\n}');
	expect(document?.root.children).toHaveLength(1);
	expect(document?.nodes.get("/same")).toMatchObject({ startLine: 3, endLine: 3 });
	expect(document?.nodes.get("/same/value")?.value).toBe(2);
});

test("a JSON node selection round-trips and is unplaced after destructive editing", () => {
	const original = scanJson('{\n  "a": {\n    "b": 1\n  }\n}');
	const node = original?.nodes.get("/a/b");
	expect(node).toBeDefined();
	const draft = node ? jsonNodeDraft(node) : null;
	expect(draft).toEqual({
		selectors: [
			{ kind: "lineRange", startLine: 3, endLine: 3 },
			{ kind: "structural", scheme: "json-pointer", ref: "/a/b" },
		],
		label: "/a/b",
	});
	const anchor: ReviewAnchor = {
		path: "data.json",
		side: "worktree",
		contentHash: "hash",
		selectors: [
			...(draft?.selectors ?? []),
			{ kind: "textQuote", exact: '    "b": 1', prefix: "", suffix: "" },
		],
	};
	expect(original && jsonNodeOfAnchor(anchor, original)?.pointer).toBe("/a/b");
	const edited = scanJson('{ "a": {} }');
	expect(edited && jsonNodeOfAnchor(anchor, edited)).toBeNull();
	const moved = scanJson('{\n  "items": [\n    { "id": "new" },\n    { "id": "old" }\n  ]\n}');
	const stalePointer: ReviewAnchor = {
		path: "data.json",
		side: "worktree",
		selectors: [
			{ kind: "lineRange", startLine: 4, endLine: 4 },
			{ kind: "structural", scheme: "json-pointer", ref: "/items/0" },
		],
	};
	expect(moved && jsonNodeOfAnchor(stalePointer, moved)).toBeNull();
});

test("JSON renderer registration is limited to JSON and JSONC", () => {
	expect(jsonRenderer).toMatchObject({
		id: "thinkrail/json",
		label: "Tree",
		match: { glob: ["*.json", "*.jsonc"], text: true },
		rank: 120,
		capabilities: {
			anchors: {
				view: ["line", "structural:json-pointer"],
				diff: ["line", "structural:json-pointer"],
			},
			mobile: true,
		},
	});
});
