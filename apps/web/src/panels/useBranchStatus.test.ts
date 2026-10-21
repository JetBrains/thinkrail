import { expect, test } from "bun:test";
import {
	type BranchAnswer,
	CI_DISCOVERY_POLLS,
	createBranchStatusState,
} from "./branchStatusState";
import {
	branchAnswer,
	CI_POLL_INTERVAL_MS,
	ciPollWanted,
	isOpenBranchReview,
	openReviewLabel,
	resolveBranchReview,
	startBranchStatusSync,
	startCiPoll,
} from "./useBranchStatus";

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
	const details = { draft: true, reviewers: [], mergeState: "draft" } as const;
	expect(resolveBranchReview({ ...snapshot, details }, snapshot, true).review?.details).toBe(
		details,
	);
	expect(
		resolveBranchReview({ ...snapshot, number: 2, details }, snapshot, true).review?.details,
	).toBeUndefined();
});

test("only an open review (or a pre-v78 one without state) is an open review for PR actions", () => {
	expect(isOpenBranchReview({ kind: "pull-request", number: 1 })).toBe(true);
	expect(isOpenBranchReview({ kind: "pull-request", number: 1, state: "open" })).toBe(true);
	expect(isOpenBranchReview({ kind: "pull-request", number: 1, state: "merged" })).toBe(false);
	expect(isOpenBranchReview({ kind: "merge-request", number: 1, state: "closed" })).toBe(false);
});

test("activation opts into cache reuse while focus performs a fresh read", async () => {
	const state = createBranchStatusState();
	const focusTarget = new EventTarget();
	const calls: Array<{ workspaceId: string; allowCached?: true }> = [];
	const releases: Array<(answer: BranchAnswer) => void> = [];
	const controller = startBranchStatusSync({
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
	releases[0]?.({ review: { kind: "pull-request", number: 1 }, status: null });
	releases[1]?.({ review: { kind: "pull-request", number: 2 }, status: null });
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
	const controller = startBranchStatusSync({
		workspaceId: "w1",
		key: "w1\0feature",
		state: createBranchStatusState(),
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

test("a v87 branch status folds its counts onto the review and keeps the facts review-free", () => {
	const base = {
		hasOrigin: true,
		provider: "github" as const,
		published: true,
		pushesElsewhere: false,
		aheadOfBase: 4,
		onBase: false,
	};
	expect(branchAnswer({ ...base, ahead: 2, behind: 1, review: null })).toEqual({
		review: null,
		status: { ...base, ahead: 2, behind: 1 },
	});
	const review = { kind: "pull-request" as const, number: 5, state: "open" as const };
	const folded = { ...review, unpushedCommits: 2, behindCommits: 1 };
	expect(branchAnswer({ ...base, ahead: 2, behind: 1, review })).toEqual({
		review: folded,
		status: { ...base, ahead: 2, behind: 1 },
	});
	expect(branchAnswer({ ...base, ahead: 0, behind: 0, review }).review).toEqual(review);
});

test("a CI poll reads the review fresh but skips the fetch, and only while connected", () => {
	const calls: unknown[] = [];
	const controller = startBranchStatusSync({
		workspaceId: "w1",
		key: "w1\0poll",
		state: createBranchStatusState(),
		focusTarget: new EventTarget(),
		connected: false,
		request: (params) => {
			calls.push(params);
			return new Promise(() => {});
		},
	});
	controller.poll();
	expect(calls).toEqual([]);
	controller.setConnected(true);
	controller.poll();
	expect(calls).toEqual([
		{ workspaceId: "w1", allowCached: true },
		{ workspaceId: "w1", skipFetch: true },
	]);
	controller.stop();
});

test("the CI poll ticks every 20 s, skips hidden windows, and stops cleanly", () => {
	const ticks: Array<() => void> = [];
	let interval = 0;
	let cleared = false;
	let visible = true;
	let polls = 0;
	const stop = startCiPoll({
		poll: () => {
			polls += 1;
		},
		visible: () => visible,
		setInterval: (run, ms) => {
			ticks.push(run);
			interval = ms;
			return 7;
		},
		clearInterval: (handle) => {
			cleared = handle === 7;
		},
	});
	expect(interval).toBe(CI_POLL_INTERVAL_MS);
	expect(CI_POLL_INTERVAL_MS).toBe(20_000);
	ticks[0]?.();
	visible = false;
	ticks[0]?.();
	expect(polls).toBe(1);
	stop();
	expect(cleared).toBe(true);
});

test("an open PR polls while checks run, and for a few polls after an action before any appear", () => {
	const review = (pending: number | null, state: "open" | "merged" = "open") => ({
		kind: "pull-request" as const,
		number: 1,
		state,
		details: {
			draft: false,
			reviewers: [],
			mergeState: "unknown" as const,
			...(pending === null
				? {}
				: { checks: { passing: 1, pending, failing: 0, failingNames: [] } }),
		},
	});
	expect(ciPollWanted({ review: review(2) })).toBe(true);
	expect(ciPollWanted({ review: review(0) })).toBe(false);
	expect(ciPollWanted({ review: review(null) })).toBe(false);
	expect(ciPollWanted({ review: review(null), discovery: 1 })).toBe(true);
	expect(ciPollWanted({ review: review(2, "merged") })).toBe(false);
	expect(ciPollWanted({ review: { kind: "pull-request", number: 1 }, discovery: 3 })).toBe(false);
	expect(ciPollWanted(null)).toBe(false);

	const state = createBranchStatusState();
	const key = "w1\0discovery";
	state.resolveRequest(key, state.beginRequest(key), { review: review(null), status: null });
	state.startDiscovery(key);
	expect(state.getSnapshot(key)?.discovery).toBe(CI_DISCOVERY_POLLS);
	state.resolveRequest(key, state.beginRequest(key), { review: review(0), status: null });
	expect(state.getSnapshot(key)?.discovery).toBe(CI_DISCOVERY_POLLS);
	for (let poll = 0; poll < CI_DISCOVERY_POLLS; poll += 1) state.spendDiscovery(key);
	expect(state.getSnapshot(key)?.discovery).toBeUndefined();
	expect(ciPollWanted(state.getSnapshot(key))).toBe(false);
});
