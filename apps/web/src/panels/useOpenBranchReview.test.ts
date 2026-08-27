import { expect, test } from "bun:test";
import { createOpenBranchReviewState } from "./openBranchReviewState";
import { openReviewLabel, startOpenBranchReviewSync } from "./useOpenBranchReview";

test("formats provider-native review references", () => {
	expect(openReviewLabel({ kind: "pull-request", number: 214 })).toBe("PR #214");
	expect(openReviewLabel({ kind: "merge-request", number: 73 })).toBe("MR !73");
});

test("activation opts into cache reuse while focus performs a fresh read", async () => {
	const state = createOpenBranchReviewState();
	const focusTarget = new EventTarget();
	const calls: Array<{ workspaceId: string; allowCached?: true }> = [];
	const releases: Array<(review: { kind: "pull-request"; number: number } | null) => void> = [];
	const controller = startOpenBranchReviewSync({
		workspaceId: "w1",
		key: "w1\0feature",
		state,
		focusTarget,
		connected: true,
		request: (params) => {
			calls.push(params);
			return new Promise((resolve) => releases.push(resolve));
		},
	});

	expect(calls).toEqual([{ workspaceId: "w1", allowCached: true }]);
	focusTarget.dispatchEvent(new Event("focus"));
	expect(calls).toEqual([{ workspaceId: "w1", allowCached: true }, { workspaceId: "w1" }]);
	releases[0]?.({ kind: "pull-request", number: 1 });
	releases[1]?.({ kind: "pull-request", number: 2 });
	await Promise.resolve();
	await Promise.resolve();
	expect(state.getSnapshot("w1\0feature")?.review).toEqual({
		kind: "pull-request",
		number: 2,
	});

	controller.setConnected(false);
	focusTarget.dispatchEvent(new Event("focus"));
	expect(calls).toHaveLength(2);
	controller.setConnected(true);
	expect(calls).toEqual([
		{ workspaceId: "w1", allowCached: true },
		{ workspaceId: "w1" },
		{ workspaceId: "w1" },
	]);

	controller.stop();
	focusTarget.dispatchEvent(new Event("focus"));
	expect(calls).toHaveLength(3);
});
