import { expect, test } from "bun:test";
import type { ReviewThread } from "@/resources";
import { classifyJsonDiff, oldToRenderedJsonPointers, stableObjectHash } from "./jsonDiff";
import { buildJsonDiffReviewLayout } from "./jsonDiffReview";
import { scanJson } from "./jsonScanner";

function thread(id: string, pointer: string, side: "base" | "worktree" = "base"): ReviewThread {
	return {
		id,
		anchor: {
			path: "items.json",
			side,
			selectors: [{ kind: "structural", scheme: "json-pointer", ref: pointer }],
		},
		body: id,
		status: "draft",
		anchorState: "anchored",
	};
}

test("JSON diff classification marks added, removed, and changed nodes", () => {
	const result = classifyJsonDiff(
		{ kept: 1, changed: "old", removed: true },
		{ kept: 1, changed: "new", added: [1] },
	);
	expect(result.current.get("/changed")).toMatchObject({
		kind: "changed",
		oldValue: "old",
		newValue: "new",
	});
	expect(result.current.get("/added")?.kind).toBe("added");
	expect(result.removed.get("/removed")?.kind).toBe("removed");
});

test("JSON diff classification detects moves in arrays of stable objects", () => {
	const result = classifyJsonDiff(
		[
			{ id: "a", value: 1 },
			{ id: "b", value: 2 },
		],
		[
			{ id: "b", value: 2 },
			{ id: "a", value: 1 },
		],
	);
	expect([...result.current.values()].some((mark) => mark.kind === "moved")).toBe(true);
	expect(stableObjectHash({ id: "a", value: 1 })).toBe("id:a");
	expect(stableObjectHash({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
});

test("array insertions shift base pointers to the rendered node", () => {
	const original = scanJson('[{"id":"a"},{"id":"b"}]');
	const modified = scanJson('[{"id":"new"},{"id":"a"},{"id":"b"}]');
	if (!original || !modified) throw new Error("Expected valid JSON fixtures");
	const classification = classifyJsonDiff(original.value, modified.value);
	const pointers = oldToRenderedJsonPointers(original.value, modified.value, classification.delta);
	expect(pointers.get("/0")).toBe("/1");
	expect(pointers.get("/0/id")).toBe("/1/id");
	const layout = buildJsonDiffReviewLayout({
		originalPresent: true,
		modifiedPresent: true,
		originalDocument: original,
		modifiedDocument: modified,
		classification,
		baseThreads: [thread("base-a", "/0")],
		worktreeThreads: [],
	});
	expect(layout.placements).toEqual([
		expect.objectContaining({
			thread: expect.objectContaining({ id: "base-a" }),
			section: "current",
			pointer: "/1",
		}),
	]);
});

test("array deletions remove only the deleted base pointer and shift survivors", () => {
	const original = ["a", "b", "c"];
	const modified = ["a", "c"];
	const classification = classifyJsonDiff(original, modified);
	const pointers = oldToRenderedJsonPointers(original, modified, classification.delta);
	expect(pointers.get("/0")).toBe("/0");
	expect(pointers.has("/1")).toBe(false);
	expect(pointers.get("/2")).toBe("/1");
});

test("array moves map base pointers and their descendants to the destination", () => {
	const original = [
		{ id: "a", value: 1 },
		{ id: "b", value: 2 },
		{ id: "c", value: 3 },
	];
	const modified = [original[1], original[2], original[0]];
	const classification = classifyJsonDiff(original, modified);
	const pointers = oldToRenderedJsonPointers(original, modified, classification.delta);
	expect(pointers.get("/0")).toBe("/2");
	expect(pointers.get("/0/value")).toBe("/2/value");
	expect(pointers.get("/1")).toBe("/0");
});

test("a malformed JSON side reports no rendered thread placements", () => {
	const valid = scanJson('{"value":1}');
	if (!valid) throw new Error("Expected valid JSON fixture");
	const reviewThread = thread("worktree", "/value", "worktree");
	for (const malformedSide of ["base", "worktree"] as const) {
		const originalDocument = malformedSide === "base" ? null : valid;
		const modifiedDocument = malformedSide === "worktree" ? null : valid;
		const layout = buildJsonDiffReviewLayout({
			originalPresent: true,
			modifiedPresent: true,
			originalDocument,
			modifiedDocument,
			classification: classifyJsonDiff(originalDocument?.value, modifiedDocument?.value),
			baseThreads: [thread("base", "/value")],
			worktreeThreads: [reviewThread],
		});
		expect(layout.placedThreadIds).toEqual(new Set());
		expect(layout.placements).toEqual([]);
	}
});
