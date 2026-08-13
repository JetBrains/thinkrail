import { expect, test } from "bun:test";
import { openReviewLabel } from "./useOpenBranchReview";

test("formats provider-native review references", () => {
	expect(openReviewLabel({ kind: "pull-request", number: 214 })).toBe("PR #214");
	expect(openReviewLabel({ kind: "merge-request", number: 73 })).toBe("MR !73");
});
