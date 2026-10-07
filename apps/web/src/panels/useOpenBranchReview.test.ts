import { expect, test } from "bun:test";
import { createOpenBranchReviewState } from "./openBranchReviewState";
import {
	isOpenBranchReview,
	openReviewLabel,
	resolveBranchReview,
	startOpenBranchReviewSync,
} from "./useOpenBranchReview";

test("formats provider-native review references", () => {
	expect(openReviewLabel({ kind: "pull-request", number: 214 })).toBe("PR #214");
	expect(openReviewLabel({ kind: "merge-request", number: 73 })).toBe("MR !73");
});

test("the v78 snapshot owns review state while a matching lookup contributes live details", () => {
	const snapshot = { kind: "pull-request", number: 1, state: "open" } as const;
	expect(resolveBranchReview(null, snapshot)).toEqual({ review: null, detailsKnown: false });
	expect(resolveBranchReview(null, snapshot, true)).toEqual({
		review: snapshot,
		detailsKnown: false,
	});
	const unrelated = {
		kind: "pull-request" as const,
		number: 2,
		state: "merged" as const,
		unpushedCommits: 3,
	};
	expect(resolveBranchReview(unrelated, snapshot)).toEqual({
		review: unrelated,
		detailsKnown: true,
	});
	expect(resolveBranchReview(unrelated, snapshot, true)).toEqual({
		review: snapshot,
		detailsKnown: false,
	});
	const matching = { ...snapshot, url: "https://example.test/1", unpushedCommits: 2 };
	expect(resolveBranchReview(matching, snapshot, true)).toEqual({
		review: { ...snapshot, url: "https://example.test/1", unpushedCommits: 2 },
		detailsKnown: true,
	});
	expect(resolveBranchReview(matching, null, true)).toEqual({
		review: null,
		detailsKnown: false,
	});
});

test("only an open review (or a pre-v78 one without state) is an open review for PR actions", () => {
	expect(isOpenBranchReview({ kind: "pull-request", number: 1 })).toBe(true);
	expect(isOpenBranchReview({ kind: "pull-request", number: 1, state: "open" })).toBe(true);
	expect(isOpenBranchReview({ kind: "pull-request", number: 1, state: "merged" })).toBe(false);
	expect(isOpenBranchReview({ kind: "merge-request", number: 1, state: "closed" })).toBe(false);
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

test("reload re-reads cache-eligible and is dropped while disconnected", () => {
	const calls: Array<{ workspaceId: string; allowCached?: true }> = [];
	const controller = startOpenBranchReviewSync({
		workspaceId: "w1",
		key: "w1\0feature",
		state: createOpenBranchReviewState(),
		focusTarget: new EventTarget(),
		connected: true,
		request: (params) => {
			calls.push(params);
			return new Promise(() => {});
		},
	});

	controller.reload();
	expect(calls).toEqual([
		{ workspaceId: "w1", allowCached: true },
		{ workspaceId: "w1", allowCached: true },
	]);
	controller.setConnected(false);
	controller.reload();
	controller.setConnected(true);
	expect(calls).toEqual([
		{ workspaceId: "w1", allowCached: true },
		{ workspaceId: "w1", allowCached: true },
		{ workspaceId: "w1", allowCached: true },
	]);
	controller.stop();
});
