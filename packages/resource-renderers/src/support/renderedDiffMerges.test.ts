import { expect, test } from "bun:test";
import {
	type DoneMerge,
	MERGE_CACHE_SIZE,
	MERGE_CACHE_TEXT,
	mergeKey,
	peekMerge,
	rememberMerge,
} from "./renderedDiffMerges";

const done = (html: string, before = ""): DoneMerge => ({ state: "done", html, before });

test("the key depends on both sides and on their order, not on string identity", () => {
	const before = "<p>a</p>";
	const after = "<p>b</p>";
	expect(mergeKey(before, after)).toBe(mergeKey(`<p>${"a"}</p>`, `<p>${"b"}</p>`));
	expect(mergeKey(before, after)).not.toBe(mergeKey(after, before));
	expect(mergeKey(before, after)).not.toBe(mergeKey(before, "<p>c</p>"));
});

test("remembering refreshes recency, so the least recently used merge is evicted", () => {
	rememberMerge("lru-keep", done("keep"));
	for (let index = 0; index < MERGE_CACHE_SIZE - 1; index += 1) {
		rememberMerge(`lru-fill-${index}`, done(`fill-${index}`));
	}
	const kept = peekMerge("lru-keep");
	expect(kept?.html).toBe("keep");
	if (kept) rememberMerge("lru-keep", kept);
	rememberMerge("lru-overflow", done("overflow"));
	expect(peekMerge("lru-keep")?.html).toBe("keep");
	expect(peekMerge("lru-fill-0")).toBeUndefined();
	expect(peekMerge("lru-overflow")?.html).toBe("overflow");
});

test("retained text is bounded, but the newest merge always stays", () => {
	const half = "x".repeat(MERGE_CACHE_TEXT / 2);
	rememberMerge("text-a", done(half));
	rememberMerge("text-b", done(half, "y"));
	expect(peekMerge("text-a")).toBeUndefined();
	expect(peekMerge("text-b")).toBeDefined();
	rememberMerge("text-huge", done("z".repeat(MERGE_CACHE_TEXT + 1)));
	expect(peekMerge("text-b")).toBeUndefined();
	expect(peekMerge("text-huge")).toBeDefined();
});
