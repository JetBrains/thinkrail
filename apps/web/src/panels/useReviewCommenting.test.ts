import { expect, test } from "bun:test";
import { commentKindForDraft, draftNeedsRichAnchors } from "./useReviewCommenting";

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
			selectors: [{ kind: "region", x: 0, y: 0, width: 1, height: 1 }],
			label: "region",
		}),
	).toBe("diff");
});
