import { expect, test } from "bun:test";
import type { ReviewComment, ReviewGuide } from "@thinkrail/contracts";
import { guideSteps } from "./ChangesReviewGuide";

function comment(over: Partial<ReviewComment>): ReviewComment {
	return {
		id: "c",
		reviewId: "r",
		kind: "diff",
		anchor: { path: "src/a.ts", side: "worktree", selectors: [] },
		body: "finding",
		status: "draft",
		anchorState: "anchored",
		createdAt: 1,
		...over,
	};
}

const guide: ReviewGuide = {
	summary: "ok",
	readingOrder: [
		{ path: "src/b.ts", why: "second" },
		{ path: "src/a.ts", why: "first" },
	],
	verdict: "request_changes",
	todoId: "t",
	sessionId: "s",
	reviewedSha: "abc",
	at: 1,
};

test("guide steps walk the reading order first, then the open agent findings by path", () => {
	const steps = guideSteps(guide, [
		comment({ id: "u1", author: "user" }),
		comment({
			id: "f2",
			author: "agent",
			anchor: { path: "src/z.ts", side: "worktree", selectors: [] },
		}),
		comment({ id: "f1", author: "agent", status: "sent" }),
		comment({ id: "f0", author: "agent", status: "resolved" }),
		comment({ id: "f3", author: "agent", anchor: null }),
	]);
	expect(
		steps.map((step) => (step.kind === "read" ? `read:${step.path}` : `find:${step.comment.id}`)),
	).toEqual(["read:src/b.ts", "read:src/a.ts", "find:f3", "find:f1", "find:f2"]);
	const finding = steps[2];
	expect(finding?.kind === "finding" && finding.path).toBeNull();
});

test("without a guide or findings there is nothing to walk", () => {
	expect(guideSteps(undefined, undefined)).toEqual([]);
	expect(guideSteps(undefined, [comment({ author: "user" })])).toEqual([]);
	expect(guideSteps({ ...guide, readingOrder: [] }, [])).toEqual([]);
});
