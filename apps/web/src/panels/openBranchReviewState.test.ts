import { expect, test } from "bun:test";
import { createOpenBranchReviewState } from "./openBranchReviewState";

const pullRequest = (number: number, unpushedCommits?: number) => ({
	kind: "pull-request" as const,
	number,
	...(unpushedCommits === undefined ? {} : { unpushedCommits }),
});

test("one keyed snapshot is shared by every subscriber", () => {
	const state = createOpenBranchReviewState();
	let first = 0;
	let second = 0;
	const stopFirst = state.subscribe("w\0feature", () => {
		first += 1;
	});
	const stopSecond = state.subscribe("w\0feature", () => {
		second += 1;
	});

	state.noteOpenReview("w\0feature", pullRequest(7), "https://github.com/acme/app/pull/7");
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(7),
		url: "https://github.com/acme/app/pull/7",
	});
	expect(first).toBe(1);
	expect(second).toBe(1);

	stopFirst();
	state.noteOpenReview("w\0feature", pullRequest(8));
	expect(first).toBe(1);
	expect(second).toBe(2);
	stopSecond();
});

test("only the newest request generation may update a key", () => {
	const state = createOpenBranchReviewState();
	const stale = state.beginRequest("w\0feature");
	const fresh = state.beginRequest("w\0feature");

	expect(state.resolveRequest("w\0feature", stale, pullRequest(1))).toBe(false);
	expect(state.resolveRequest("w\0feature", fresh, pullRequest(2))).toBe(true);
	expect(state.getSnapshot("w\0feature")?.review).toEqual(pullRequest(2));
});

test("an authoritative mutation supersedes a read already in flight", () => {
	const state = createOpenBranchReviewState();
	const pending = state.beginRequest("w\0feature");
	state.noteOpenReview("w\0feature", pullRequest(7), "https://github.com/acme/app/pull/7");

	expect(state.resolveRequest("w\0feature", pending, null)).toBe(false);
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(7),
		url: "https://github.com/acme/app/pull/7",
	});
});

test("a same-review refresh preserves its known URL while a different review drops it", () => {
	const state = createOpenBranchReviewState();
	state.noteOpenReview("w\0feature", pullRequest(7), "https://github.com/acme/app/pull/7");
	const same = state.beginRequest("w\0feature");
	state.resolveRequest("w\0feature", same, pullRequest(7, 2));
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(7, 2),
		url: "https://github.com/acme/app/pull/7",
	});

	const different = state.beginRequest("w\0feature");
	state.resolveRequest("w\0feature", different, pullRequest(8));
	expect(state.getSnapshot("w\0feature")).toEqual({ review: pullRequest(8) });
});
