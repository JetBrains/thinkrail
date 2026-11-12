import { expect, test } from "bun:test";
import { commentKindForDraft, draftNeedsRichAnchors, reviewFocusId } from "./useReviewCommenting";

test("only region and structural selectors need the rich-anchor host capability", () => {
	expect(
		draftNeedsRichAnchors({
			selectors: [{ kind: "lineRange", startLine: 1, endLine: 2 }],
			label: "L1–2",
		}),
	).toBe(false);
	expect(draftNeedsRichAnchors({ selectors: [], label: "file" })).toBe(false);
	expect(
		draftNeedsRichAnchors({
			selectors: [{ kind: "region", x: 0, y: 0, width: 1, height: 1 }],
			label: "region",
		}),
	).toBe(true);
	expect(
		draftNeedsRichAnchors({
			selectors: [
				{ kind: "lineRange", startLine: 3, endLine: 3 },
				{ kind: "structural", scheme: "json-pointer", ref: "/a" },
			],
			label: "/a",
		}),
	).toBe(true);
});

test("a positioned draft keeps its surface kind and a bare draft is a file comment", () => {
	expect(commentKindForDraft("inline", { selectors: [], label: "file" })).toBe("file");
	expect(
		commentKindForDraft("diff", {
			selectors: [{ kind: "diffHunk", hunkHeader: "@@ -1,1 +1,0 @@" }],
			label: "removed lines",
		}),
	).toBe("file");
	expect(
		commentKindForDraft("diff", {
			selectors: [{ kind: "region", x: 0, y: 0, width: 1, height: 1 }],
			label: "region",
		}),
	).toBe("diff");
});

test("a surface-targeted focus is left for that surface, not a mounted sibling", () => {
	const toFile = { workspaceId: "w1", commentId: "c1", surface: { kind: "inline" as const } };
	expect(reviewFocusId(toFile, "w1", "inline")).toBe("c1");
	expect(reviewFocusId(toFile, "w1", "diff", { kind: "branch" })).toBeNull();
	expect(reviewFocusId(toFile, "w2", "inline")).toBeNull();
});

test("a diff focus is left for the diff of its scope, not a mounted diff of another base", () => {
	const scope = { kind: "pinned" as const, baseRef: "abc123" };
	const toPinned = {
		workspaceId: "w1",
		commentId: "c1",
		surface: { kind: "diff" as const, scope },
	};
	expect(reviewFocusId(toPinned, "w1", "diff", { kind: "pinned", baseRef: "abc123" })).toBe("c1");
	expect(reviewFocusId(toPinned, "w1", "diff", { kind: "branch" })).toBeNull();
	expect(reviewFocusId(toPinned, "w1", "inline")).toBeNull();
});
