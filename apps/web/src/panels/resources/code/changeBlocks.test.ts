import { describe, expect, test } from "bun:test";
import { commentKindForDraft } from "../../useReviewCommenting";
import { computeActionBlocks, computeChangeBlocks, createAskAgentRequest } from "./changeBlocks";

describe("computeChangeBlocks", () => {
	test("returns separate engine-neutral spans for separated edits", () => {
		expect(computeChangeBlocks("a\nb\nc\nd\ne\n", "a\nB\nc\nd\nE\n", false)).toEqual([
			{ original: { start: 2, count: 1 }, modified: { start: 2, count: 1 } },
			{ original: { start: 5, count: 1 }, modified: { start: 5, count: 1 } },
		]);
	});

	test("keeps insertion and deletion points as zero-count spans", () => {
		expect(computeChangeBlocks("a\nc\n", "a\nb\nc\n", false)).toEqual([
			{ original: { start: 2, count: 0 }, modified: { start: 2, count: 1 } },
		]);
		expect(computeChangeBlocks("a\nb\nc\n", "a\nc\n", false)).toEqual([
			{ original: { start: 2, count: 1 }, modified: { start: 2, count: 0 } },
		]);
	});

	test("treats a CR-only file as one line", () => {
		expect(computeChangeBlocks("one\rtwo", "one\rTWO", false)).toEqual([
			{ original: { start: 1, count: 1 }, modified: { start: 1, count: 1 } },
		]);
	});

	test("uses the rendered diff's whitespace policy", () => {
		expect(computeChangeBlocks("const value = 1;\n", "  const value = 1;\n", false)).toHaveLength(
			1,
		);
		expect(computeChangeBlocks("const value = 1;\n", "  const value = 1;\n", true)).toEqual([]);
	});

	test("a deleted file has no per-block actions", () => {
		expect(computeActionBlocks("one\ntwo\n", null, false)).toEqual([]);
	});

	test("an EOF deletion anchors Ask agent to the preceding worktree line", () => {
		const [block] = computeActionBlocks("one\ntwo\nthree\n", "one\ntwo\n", false);
		if (!block) throw new Error("missing deletion block");
		const request = createAskAgentRequest(block, "one\ntwo\n");

		expect(request.draft.selectors).toEqual([
			{ kind: "lineRange", startLine: 2, endLine: 2 },
			{ kind: "diffHunk", hunkHeader: "@@ -3,1 +3,0 @@" },
		]);
		expect(request.notice).toBe("This comment refers to removed lines.");
	});

	test("a top-of-file deletion anchors Ask agent to line one", () => {
		const [block] = computeActionBlocks("zero\none\ntwo\n", "one\ntwo\n", false);
		if (!block) throw new Error("missing deletion block");
		const request = createAskAgentRequest(block, "one\ntwo\n");

		expect(request.draft.selectors[0]).toEqual({
			kind: "lineRange",
			startLine: 1,
			endLine: 1,
		});
		expect(request.notice).toBe("This comment refers to removed lines.");
	});

	test("a deletion from an empty worktree file produces a whole-file Ask agent comment", () => {
		const [block] = computeActionBlocks("only\n", "", false);
		if (!block) throw new Error("missing deletion block");
		const request = createAskAgentRequest(block, "");

		expect(request.draft.selectors).toEqual([{ kind: "diffHunk", hunkHeader: "@@ -1,1 +1,0 @@" }]);
		expect(commentKindForDraft("diff", request.draft)).toBe("file");
	});
});
