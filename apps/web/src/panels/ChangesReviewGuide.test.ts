import { expect, test } from "bun:test";
import type { ReviewComment, ReviewGuide } from "@thinkrail/contracts";
import { guideCursorIndex, guideStepKey, guideSteps, nextGuideStep } from "./ChangesReviewGuide";

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

test("stepping skips reading steps for files outside the scope and wraps around", () => {
	const steps = guideSteps(guide, [comment({ id: "f1", author: "agent" })]);
	const scope = new Set(["src/a.ts"]);
	// steps: read b (out of scope), read a, finding on a
	expect(nextGuideStep(steps, scope, -1, 1)).toBe(1);
	expect(nextGuideStep(steps, scope, 1, 1)).toBe(2);
	expect(nextGuideStep(steps, scope, 2, 1)).toBe(1);
	expect(nextGuideStep(steps, scope, 1, -1)).toBe(2);
	expect(nextGuideStep(steps, new Set(), -1, 1)).toBeNull();
	expect(nextGuideStep([], scope, -1, 1)).toBeNull();
});

test("the cursor follows its step by identity, and a step resolved from under it yields to its successor", () => {
	const steps = guideSteps(guide, [
		comment({ id: "f1", author: "agent" }),
		comment({
			id: "f2",
			author: "agent",
			anchor: { path: "src/z.ts", side: "worktree", selectors: [] },
		}),
	]);
	const onF1 = { key: guideStepKey(steps[2] as (typeof steps)[number]), index: 2 };
	expect(guideCursorIndex(steps, onF1)).toBe(2);
	// a reading step inserted ahead moves the finding down; the cursor stays on it
	const grown = guideSteps(
		{ ...guide, readingOrder: [...guide.readingOrder, { path: "src/c.ts", why: "third" }] },
		[comment({ id: "f1", author: "agent" }), comment({ id: "f2", author: "agent" })],
	);
	expect(guideCursorIndex(grown, onF1)).toBe(3);
	// f1 resolved: Next from the cursor lands on f2, which took f1's slot
	const shrunk = guideSteps(guide, [comment({ id: "f2", author: "agent" })]);
	const after = guideCursorIndex(shrunk, onF1);
	expect(after).toBe(1);
	expect(nextGuideStep(shrunk, new Set(["src/a.ts", "src/b.ts"]), after, 1)).toBe(2);
	expect(guideCursorIndex(steps, null)).toBe(-1);
});
