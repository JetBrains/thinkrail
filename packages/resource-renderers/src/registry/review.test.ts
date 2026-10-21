import { expect, test } from "bun:test";
import type { ReviewAnchor } from "@thinkrail/contracts";
import { outdatedReason } from "./review";

test("an outdated anchor explains itself by what it could have re-found", () => {
	const anchor = (selectors: ReviewAnchor["selectors"]) => ({
		path: "a.png",
		side: "worktree" as const,
		contentHash: "h",
		selectors,
	});
	expect(
		outdatedReason(
			anchor([
				{ kind: "textQuote", exact: "x", prefix: "", suffix: "" },
				{ kind: "lineRange", startLine: 1, endLine: 1 },
			]),
		),
	).toMatch(/changed or is gone.*text was not found again/);
	expect(outdatedReason(anchor([{ kind: "region", x: 0, y: 0, width: 1, height: 1 }]))).toMatch(
		/bytes changed or it is gone.*cannot be re-verified/,
	);
	expect(outdatedReason(anchor([]))).toMatch(/is gone/);
	expect(outdatedReason(null)).toMatch(/is gone/);
});
