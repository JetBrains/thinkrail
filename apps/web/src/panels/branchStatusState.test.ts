import { expect, test } from "bun:test";
import type { OpenBranchReview } from "@thinkrail/contracts";
import { type BranchFacts, createBranchStatusState } from "./branchStatusState";

const answer = (review: OpenBranchReview | null) => ({ review, status: null });

const pullRequest = (number: number, unpushedCommits?: number) => ({
	kind: "pull-request" as const,
	number,
	...(unpushedCommits === undefined ? {} : { unpushedCommits }),
});

test("one keyed snapshot is shared by every subscriber", () => {
	const state = createBranchStatusState();
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
	const state = createBranchStatusState();
	const stale = state.beginRequest("w\0feature");
	const fresh = state.beginRequest("w\0feature");

	expect(state.resolveRequest("w\0feature", stale, answer(pullRequest(1)))).toBe(false);
	expect(state.resolveRequest("w\0feature", fresh, answer(pullRequest(2)))).toBe(true);
	expect(state.getSnapshot("w\0feature")?.review).toEqual(pullRequest(2));
});

test("an authoritative mutation supersedes a read already in flight", () => {
	const state = createBranchStatusState();
	const pending = state.beginRequest("w\0feature");
	state.noteOpenReview("w\0feature", pullRequest(7), "https://github.com/acme/app/pull/7");

	expect(state.resolveRequest("w\0feature", pending, answer(null))).toBe(false);
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(7),
		url: "https://github.com/acme/app/pull/7",
	});
});

test("a same-review refresh preserves its known URL while a different review drops it", () => {
	const state = createBranchStatusState();
	state.noteOpenReview("w\0feature", pullRequest(7), "https://github.com/acme/app/pull/7");
	const same = state.beginRequest("w\0feature");
	state.resolveRequest("w\0feature", same, answer(pullRequest(7, 2)));
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(7, 2),
		url: "https://github.com/acme/app/pull/7",
	});

	const different = state.beginRequest("w\0feature");
	state.resolveRequest("w\0feature", different, answer(pullRequest(8)));
	expect(state.getSnapshot("w\0feature")).toEqual({ review: pullRequest(8) });
});

test("a lookup's own url makes the chip a link on a fresh client, with no prior noteOpenReview", () => {
	const state = createBranchStatusState();
	const generation = state.beginRequest("w\0feature");
	state.resolveRequest(
		"w\0feature",
		generation,
		answer({ ...pullRequest(464), url: "https://github.com/acme/app/pull/464" }),
	);
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: { ...pullRequest(464), url: "https://github.com/acme/app/pull/464" },
		url: "https://github.com/acme/app/pull/464",
	});
});

test("a url already known survives a lookup for the same review that reports none", () => {
	const state = createBranchStatusState();
	state.noteOpenReview("w\0feature", pullRequest(464), "https://github.com/acme/app/pull/464");
	const generation = state.beginRequest("w\0feature");
	state.resolveRequest("w\0feature", generation, answer(pullRequest(464, 2)));
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(464, 2),
		url: "https://github.com/acme/app/pull/464",
	});
});

test("a v86 answer keeps its branch facts across a noted review", () => {
	const state = createBranchStatusState();
	const status: BranchFacts = {
		hasOrigin: true,
		provider: "github",
		published: true,
		ahead: 0,
		behind: 0,
		aheadOfBase: 3,
		onBase: false,
	};
	state.resolveRequest("w\0feature", state.beginRequest("w\0feature"), { review: null, status });
	expect(state.getSnapshot("w\0feature")).toEqual({ review: null, status });
	state.noteOpenReview("w\0feature", pullRequest(9), "https://github.com/acme/app/pull/9");
	expect(state.getSnapshot("w\0feature")).toEqual({
		review: pullRequest(9),
		url: "https://github.com/acme/app/pull/9",
		status,
	});
});
